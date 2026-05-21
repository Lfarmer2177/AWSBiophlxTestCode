import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser } from 'aws-amplify/auth';
import { listWorkoutsByCustomer, listWorkoutItemsByWorkout, listPermissionsByUser } from '../graphql/queries';
import Colors from '../Theme/Colors';
const LIST_PRODUCTS_BY_TRAINER = /* GraphQL */ `
  query ListWorkoutProductsByTrainer($trainer_id: ID!, $limit: Int) {
    listWorkoutProductsByTrainer(trainer_id: $trainer_id, limit: $limit) {
      workout_product_id
      name
      workout_id
      created_at
      updated_at
    }
  }
`;

const LIST_SERVICES_BY_TRAINER = /* GraphQL */ `
  query ListVirtualTrainingServicesByTrainer($trainer_id: ID!, $limit: Int) {
    listVirtualTrainingServicesByTrainer(trainer_id: $trainer_id, limit: $limit) {
      items {
        service_id
        service_name
        workout_ids
        workout_products
        created_at
        updated_at
      }
    }
  }
`;

const LIST_WORKOUTS_BY_TRAINER = /* GraphQL */ `
  query ListWorkoutsByTrainer($trainer_id: ID!, $limit: Int) {
    listWorkoutsByTrainer(trainer_id: $trainer_id, limit: $limit) {
      workout_id
      name
      created_at
      updated_at
    }
  }
`;


const GET_WORKOUT_PRODUCT = /* GraphQL */ `
  query GetWorkoutProduct($trainer_id: ID!, $workout_product_id: ID!) {
    getWorkoutProduct(trainer_id: $trainer_id, workout_product_id: $workout_product_id) {
      workout_product_id
      name
      workout_id
      created_at
      updated_at
    }
  }
`;

const LIST_CUSTOMERS_BY_USER = /* GraphQL */ `
  query ListCustomers($user_id: ID!) {
    listCustomers(filter: { user_id: { eq: $user_id } }, limit: 1) {
      items { customer_id }
      nextToken
    }
  }
`;

const GET_WORKOUT = /* GraphQL */ `
  query GetWorkout($workout_id: ID!) {
    getWorkout(workout_id: $workout_id) {
      workout_id
      name
      created_at
      updated_at
    }
  }
`;

const GET_SERVICE = /* GraphQL */ `
  query GetService($trainer_id: ID!, $service_id: ID!) {
    getVirtualTrainingService(trainer_id: $trainer_id, service_id: $service_id) {
      service_id
      service_name
      workout_ids
      workout_products
      created_at
      updated_at
    }
  }
`;
export default function WorkoutLibrary({ route,navigation }) {
  const {clientData}=route?.params || {};
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const [customerId, setCustomerId] = useState(null);
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [itemsMap, setItemsMap] = useState({});
  const [itemsLoading, setItemsLoading] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [myTrainerId, setMyTrainerId] = useState(null);

  const CREATE_WORKOUT = /* GraphQL */ `
    mutation CreateWorkout($input: CreateWorkoutInput!) {
      createWorkout(input: $input) {
        workout_id
      }
    }
  `;

  const CREATE_WORKOUT_ITEM = /* GraphQL */ `
    mutation CreateWorkoutItem($input: CreateWorkoutItemInput!) {
      createWorkoutItem(input: $input) {
        workout_item_index
      }
    }
  `;

  const GET_TRAINER = /* GraphQL */ `
    query GetTrainer($user_id: ID!) {
      listTrainers(filter: { user_id: { eq: $user_id } }, limit: 500) {
        items { trainer_id user_id }
      }
    }
  `;

  const unwrapString = (val) => {
    if (val?.S) return val.S;
    if (val?.N) return val.N;
    if (typeof val === 'string' || typeof val === 'number') return val;
    if (typeof val === 'object' && val !== null) {
      return val.S || val.value || JSON.stringify(val);
    }
    return val;
  };

  const fetchWorkouts = useCallback(
    async (custId) => {
      if (!custId) return;
      try {
        setLoading(true);
        setError(null);

        const current = await getCurrentUser();
        const user_id = current?.userId || current?.username;

        // 1. Fetch direct workouts (original behavior)
        const { data: directData } = await client.graphql({
          query: listWorkoutsByCustomer,
          variables: { customer_id: custId, limit: 50 },
        });
        const directItems = directData?.listWorkoutsByCustomer ?? [];
        
        // 2. Fetch permissions for purchased items
        let purchasedItems = [];
        
        // 3. Get Trainer ID if not set
        if (!myTrainerId) {
          const tRes = await client.graphql({
            query: GET_TRAINER,
            variables: { user_id }
          });
          const allTrainers = tRes.data.listTrainers.items;
          // Reverted to original logic
          setMyTrainerId(allTrainers[0]?.trainer_id);
        }
        try {
          const { data: permData } = await client.graphql({
            query: listPermissionsByUser,
            variables: { user_id, limit: 100 }
          });
          
          const perms = permData?.listPermissionsByUser?.items || [];
          console.log('WorkoutLibrary: Found permissions:', perms.length);
          
          // Group by trainer_id for efficient fetching
          const permsByTrainer = {};
          for (const p of perms) {
            const pStatus = unwrapString(p.status);
            if (pStatus !== 'active') continue;

            const tId = unwrapString(p.trainer_id) || 'unknown';
            if (!permsByTrainer[tId]) permsByTrainer[tId] = [];
            permsByTrainer[tId].push(p);
          }

          // Fetch products/services/workouts for each trainer and match
          for (const tId of Object.keys(permsByTrainer)) {
            try {
              console.log('WorkoutLibrary: Fetching resources for trainer:', tId);
              
              const [prodRes, svcRes, wrkRes] = await Promise.all([
                client.graphql({
                  query: LIST_PRODUCTS_BY_TRAINER,
                  variables: { trainer_id: tId, limit: 100 }
                }).catch(() => ({ data: {} })),
                client.graphql({
                  query: LIST_SERVICES_BY_TRAINER,
                  variables: { trainer_id: tId, limit: 100 }
                }).catch(() => ({ data: {} })),
                client.graphql({
                  query: LIST_WORKOUTS_BY_TRAINER,
                  variables: { trainer_id: tId, limit: 200 }
                }).catch(() => ({ data: {} }))
              ]);

              const trainerProducts = prodRes.data?.listWorkoutProductsByTrainer || [];
              const trainerServices = svcRes.data?.listVirtualTrainingServicesByTrainer?.items || [];
              const trainerWorkouts = wrkRes.data?.listWorkoutsByTrainer || [];

              // Create a map for quick name lookup
              const workoutNameMap = {};
              trainerWorkouts.forEach(w => {
                workoutNameMap[unwrapString(w.workout_id)] = w;
              });

              console.log(`WorkoutLibrary: Trainer ${tId} found ${trainerProducts.length} products, ${trainerServices.length} services, ${trainerWorkouts.length} workouts`);

              for (const perm of permsByTrainer[tId]) {
                const resId = unwrapString(perm.resource_id);
                const pType = unwrapString(perm.product_type);
                console.log(`WorkoutLibrary: Processing permission: ${pType} | Resource: ${resId}`);

                if (pType === 'workout' || pType === 'workout_product') {
                  let product = trainerProducts.find(p => unwrapString(p.workout_product_id) === resId);
                  if (!product) {
                    console.log('WorkoutLibrary: Product not in trainer list, trying direct fetch for:', resId);
                    const { data: directProd } = await client.graphql({
                      query: GET_WORKOUT_PRODUCT,
                      variables: { trainer_id: tId, workout_product_id: resId }
                    }).catch((e) => {
                      console.log('WorkoutLibrary: Direct product fetch error:', e);
                      return { data: {} };
                    });
                    product = directProd?.getWorkoutProduct;
                  }

                  if (product) {
                    const packageName = unwrapString(product.name);
                    const workoutIdsRaw = product.workout_id || [];
                    const workoutIds = (Array.isArray(workoutIdsRaw) ? workoutIdsRaw : [workoutIdsRaw]).map(id => unwrapString(id)).filter(Boolean);
                    
                    console.log(`WorkoutLibrary: Found product "${packageName}" with ${workoutIds.length} workouts`);
                    
                    for (const wid of workoutIds) {
                      const workoutInfo = workoutNameMap[wid];
                      if (workoutInfo) {
                        console.log(`WorkoutLibrary: Adding purchased workout: ${workoutInfo.name} (from ${packageName})`);
                        purchasedItems.push({
                          workout_id: unwrapString(workoutInfo.workout_id),
                          purchase_id: resId,
                          name: unwrapString(workoutInfo.name),
                          purchased_name: packageName,
                          is_purchased: true,
                          created_at: workoutInfo.created_at,
                          updated_at: workoutInfo.updated_at,
                        });
                      } else {
                        console.warn(`WorkoutLibrary: No name found for workout ID: ${wid} in trainer's list`);
                        // Fallback: use product name or placeholder if lookup fails
                        purchasedItems.push({
                          workout_id: wid,
                          purchase_id: resId,
                          name: `Workout (${wid.slice(-4)})`,
                          purchased_name: packageName,
                          is_purchased: true,
                          created_at: product.created_at,
                          updated_at: product.updated_at,
                        });
                      }
                    }
                  } else {
                    console.warn(`WorkoutLibrary: Resource ${resId} not found as product`);
                  }
                } else if (pType === 'service') {
                  let service = trainerServices.find(s => unwrapString(s.service_id) === resId);
                  if (!service) {
                    console.log('WorkoutLibrary: Service not in trainer list, trying direct fetch for:', resId);
                    const { data: directSvc } = await client.graphql({
                      query: GET_SERVICE,
                      variables: { trainer_id: tId, service_id: resId }
                    }).catch((e) => {
                      console.log('WorkoutLibrary: Direct service fetch error:', e);
                      return { data: {} };
                    });
                    service = directSvc?.getVirtualTrainingService;
                  }

                  if (service) {
                    const packageName = unwrapString(service.service_name);
                    const workoutIds = (Array.isArray(service.workout_ids) ? service.workout_ids : []).map(id => unwrapString(id)).filter(Boolean);
                    
                    console.log(`WorkoutLibrary: Found service "${packageName}" with ${workoutIds.length} workouts`);
                    
                    for (const wid of workoutIds) {
                      const workoutInfo = workoutNameMap[wid];
                      if (workoutInfo) {
                        console.log(`WorkoutLibrary: Adding purchased workout (svc): ${workoutInfo.name} (from ${packageName})`);
                        purchasedItems.push({
                          workout_id: unwrapString(workoutInfo.workout_id),
                          purchase_id: resId,
                          name: unwrapString(workoutInfo.name),
                          purchased_name: packageName,
                          is_purchased: true,
                          created_at: workoutInfo.created_at,
                          updated_at: workoutInfo.updated_at,
                        });
                      } else {
                        console.warn(`WorkoutLibrary: No name found for workout ID: ${wid} in trainer's service`);
                        purchasedItems.push({
                          workout_id: wid,
                          purchase_id: resId,
                          name: `Workout`,
                          purchased_name: packageName,
                          is_purchased: true,
                          created_at: service.created_at,
                          updated_at: service.updated_at,
                        });
                      }
                    }
                  } else {
                    console.warn(`WorkoutLibrary: Resource ${resId} not found as service`);
                  }
                }
              }
            } catch (trainerErr) {
              console.log('WorkoutLibrary: Failed to fetch resources for trainer', tId, trainerErr);
            }
          }
        } catch (err) {
          console.log('WorkoutLibrary: Failed to fetch permissions', err);
        }

        const normalizedDirect = (directItems || []).map((row) => ({
          type: 'workout',
          workout_id: row.workout_id,
          uniqueId: row.workout_id, // Unique enough for direct
          name: row.name || 'Untitled Workout',
          created_at: row.created_at,
          updated_at: row.updated_at,
          is_purchased: false,
        }));

        // Final assembly of the list with section headers
        let finalItems = [...normalizedDirect];
        
        if (purchasedItems.length > 0) {
          // Add main "Purchased Workouts" separator
          finalItems.push({ type: 'header', label: 'Purchased Workouts', id: 'purchased-heading', uniqueId: 'purchased-heading' });

          // Group purchased items by their purchased_name (package name)
          const grouped = purchasedItems.reduce((acc, item) => {
            const pkg = item.purchased_name || 'Other Purchases';
            if (!acc[pkg]) acc[pkg] = [];
            acc[pkg].push({ 
              ...item, 
              type: 'workout',
              uniqueId: `${item.purchase_id}-${item.workout_id}`
            });
            return acc;
          }, {});

          // Add each package with its sub-header
          for (const pkgName of Object.keys(grouped)) {
            finalItems.push({ 
              type: 'package_header', 
              label: pkgName, 
              id: `pkg-${pkgName}`,
              uniqueId: `pkg-${pkgName}`
            });
            finalItems.push(...grouped[pkgName]);
          }
        }

        console.log('WorkoutLibrary: Final total list items:', finalItems);
        setWorkouts(finalItems);
      } catch (err) {
        console.log('Fetch workouts failed', err);
        setError(err?.errors?.[0]?.message || 'Failed to load workouts.');
      } finally {
        setLoading(false);
      }
    },
    [client, myTrainerId]
  );

  const assignWorkoutToClient = async (template) => {
    try {
      if (!clientData?.id) {
        Alert.alert("Error", "No client selected.");
        return;
      }
      setLoading(true);

      const newWorkoutId = Math.random().toString(36).substring(7);
      const originalWorkoutId = template.workout_id;

      // 1. Create the new workout
      await client.graphql({
        query: CREATE_WORKOUT,
        variables: {
          input: {
            workout_id: newWorkoutId,
            customer_id: clientData.id,
            trainer_id: myTrainerId,
            name: `${template.name} (Assigned)`,
          }
        }
      });

      // 2. Fetch original items to duplicate them
      const itemsRes = await client.graphql({
        query: listWorkoutItemsByWorkout,
        variables: { workout_id: originalWorkoutId }
      });
      const rawData = itemsRes.data;
      let originalItems = rawData?.listWorkoutItemsByWorkout ?? rawData?.listWorkoutItems ?? [];
      
      // Handle both paginated (connection) and direct array responses
      if (originalItems?.items) {
        originalItems = originalItems.items;
      } else if (!Array.isArray(originalItems)) {
        originalItems = [];
      }

      // 3. Duplicate items into the new workout
      for (const item of originalItems) {
        await client.graphql({
          query: CREATE_WORKOUT_ITEM,
          variables: {
            input: {
              workout_id: newWorkoutId,
              workout_item_index: item.workout_item_index,
              exercise_id: item.exercise_id,
              target_sets: item.target_sets,
              target_reps: item.target_reps,
              muscle_focus: item.muscle_focus,
              target_tut: item.target_tut,
              target_velocity: item.target_velocity,
              target_weight: item.target_weight,
            }
          }
        });
      }

      Alert.alert("Success", `Workout sent to ${clientData.Demographic?.name || 'client'}!`);
    } catch (err) {
      console.log("Assign workout failed", err);
      Alert.alert("Error", "Failed to send workout to client.");
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    if (!customerId) return;
    setRefreshing(true);
    await fetchWorkouts(customerId);
    setRefreshing(false);
  }, [customerId, fetchWorkouts]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const id = await resolveCustomerId(client);
        console.log('WorkoutLibrary resolved customer_id:', id);
        if (!mounted) return;
        setCustomerId(id);
        if (id) {
          await fetchWorkouts(id);
        } else {
          setError('Unable to find a customer profile for this user.');
        }
      } catch (err) {
        console.log('Resolve customer id failed', err);
        if (mounted) setError('Unable to resolve customer profile.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [client, fetchWorkouts]);

  const ensureItems = useCallback(
    async (workout) => {
      const { workout_id, uniqueId } = workout;
      if (!workout_id) return [];
      if (itemsMap[uniqueId]) return itemsMap[uniqueId];

      try {
        setItemsLoading((prev) => ({ ...prev, [uniqueId]: true }));
        
        let allItems = [];
        const { data } = await client.graphql({
          query: listWorkoutItemsByWorkout,
          variables: { workout_id, limit: 100 },
        });
        allItems = data?.listWorkoutItemsByWorkout ?? data?.listWorkoutItems ?? [];

        const normalized = allItems
          .map(normalizeWorkoutItem)
          .sort((a, b) => (a.workout_item_index || 0) - (b.workout_item_index || 0));
        
        setItemsMap((prev) => ({ ...prev, [uniqueId]: normalized }));
        return normalized;
      } catch (err) {
        console.log('Workout items fetch failed', err);
        setError(err?.errors?.[0]?.message || 'Failed to load workout items.');
        return [];
      } finally {
        setItemsLoading((prev) => ({ ...prev, [uniqueId]: false }));
      }
    },
    [client, itemsMap]
  );

  const toggleExpand = async (item) => {
    if (expandedId === item.uniqueId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.uniqueId);
    await ensureItems(item);
  };

  const goToRunner = useCallback(
    async (workout) => {
      const items = await ensureItems(workout);
      navigation.navigate('WorkoutRunner', {
        customer_id: customerId,
        workoutPlan: {
          workout_id: workout.workout_id,
          name: workout.name,
          items: items || [],
        },
      });
    },
    [customerId, navigation, ensureItems]
  );

  const renderWorkout = ({ item }) => {
    if (item.type === 'header') {
      return (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>{item.label}</Text>
        </View>
      );
    }
    
    if (item.type === 'package_header') {
      return (
        <View style={styles.packageHeader}>
          <Text style={styles.packageHeaderText}>{item.label}</Text>
        </View>
      );
    }

    const isOpen = expandedId === item.uniqueId;
    const itemList = itemsMap[item.uniqueId] || [];
    const loadingItems = itemsLoading[item.uniqueId];

    return (
      <View style={styles.card}>
        <Pressable onPress={() => toggleExpand(item)} style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.workoutName}>{item.name}</Text>
            {item.is_purchased && (
              <View style={styles.badgeRow}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>PURCHASED</Text>
                </View>
              </View>
            )}
            <Text style={styles.workoutMeta}>
              Created {formatDate(item.created_at)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {clientData && (
              <TouchableOpacity 
                style={[styles.performButton, { backgroundColor: Colors.APP_BLUE, marginRight: 8 }]} 
                onPress={() => assignWorkoutToClient(item)}
              >
                <Text style={styles.performText}>Send to Client</Text>
              </TouchableOpacity>
            )}
            {!clientData && (
              <TouchableOpacity style={styles.performButton} onPress={() => goToRunner(item)}>
                <Text style={styles.performText}>Perform</Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
        {isOpen && (
          <View style={styles.itemsSection}>
            {loadingItems ? (
              <ActivityIndicator />
            ) : itemList.length === 0 ? (
              <Text style={styles.empty}>No exercises added yet.</Text>
            ) : (
              itemList.map((entry) => (
                <View key={`${item.uniqueId}-${entry.workout_item_index}`} style={styles.itemRow}>
                  <Text style={styles.itemTitle}>
                    {entry.workout_item_index}. {entry.exercise_id}
                  </Text>
                  <Text style={styles.itemMeta}>Muscle focus: {entry.muscle_focus || 'N/A'}</Text>
                  <Text style={styles.itemMeta}>
                    Target sets: {entry.target_sets ?? '-'} · Target reps: {entry.target_reps ?? '-'}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}
      </View>
    );
  };

  if (loading && !workouts.length) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        contentContainerStyle={styles.list}
        data={workouts}
        keyExtractor={(item) => item.uniqueId}
        renderItem={renderWorkout}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={<Text style={styles.empty}>No workouts created yet.</Text>}
      />
    </SafeAreaView>
  );
}

async function resolveCustomerId(client) {
  try {
    const current = await getCurrentUser();
    const user_id = current?.userId || current?.username;
    if (!user_id) {
      console.log('resolveCustomerId: No user_id found');
      return null;
    }

    // 1. Check if user already has a customer record
    const { data } = await client.graphql({
      query: LIST_CUSTOMERS_BY_USER,
      variables: { user_id },
    });
    
    const existing = data?.listCustomers?.items?.[0]?.customer_id;
    if (existing) {
      console.log('resolveCustomerId: Found existing customer_id:', existing);
      return existing;
    }

    // 2. If not, create a new customer record using user_id as customer_id
    // This maintains consistency with ProfileSetup.js logic
    console.log('resolveCustomerId: No customer found, creating one for user_id:', user_id);
    const CREATE_CUSTOMER = /* GraphQL */ `
      mutation CreateCustomer($input: CreateCustomerInput!) {
        createCustomer(input: $input) { customer_id }
      }
    `;

    const res = await client.graphql({
      query: CREATE_CUSTOMER,
      variables: { 
        input: { 
          customer_id: user_id, 
          user_id,
          preferred_workout_location: null,
          fitness_focus: null 
        } 
      },
    });

    const resolved = res?.data?.createCustomer?.customer_id || user_id;
    console.log('resolveCustomerId: Successfully created/resolved customer_id:', resolved);
    return resolved;
  } catch (error) {
    console.log('resolveCustomerId error:', error);
    return null;
  }
}

const formatDate = (value) => {
  if (!value) return 'N/A';
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
};

const normalizeWorkoutItem = (raw) => ({
  workout_id: unwrap(raw?.workout_id),
  workout_item_index: Number(raw?.workout_item_index ?? raw?.workout_item_index?.N ?? raw?.workout_item_index) || 0,
  exercise_id: unwrap(raw?.exercise_id),
  muscle_focus: unwrap(raw?.muscle_focus),
  target_sets: toNumber(raw?.target_sets),
  target_reps: toNumber(raw?.target_reps),
});

const unwrap = (value) => {
  if (value && typeof value === 'object') {
    if (value.S !== undefined) return value.S;
    if (value.value !== undefined) return value.value;
  }
  if (typeof value === 'string' && value.startsWith('{S=') && value.endsWith('}')) {
    return value.slice(3, -1);
  }
  return value ?? '';
};

const toNumber = (value) => {
  if (value && typeof value === 'object' && value.N !== undefined) {
    return Number(value.N);
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  itemMeta: {
    fontSize: 12,
    color: '#475569',
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  workoutName: {
    fontSize: 18,
    fontWeight: '600',
  },
  workoutMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  expand: {
    color: '#4f46e5',
    fontWeight: '600',
  },
  performButton: {
    marginLeft: 12,
    backgroundColor: '#16a34a',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  performText: {
    color: '#fff',
    fontWeight: '600',
  },
  itemsSection: {
    marginTop: 12,
    borderTopWidth: 1,
    borderColor: '#e2e8f0',
    paddingTop: 12,
    gap: 6,
  },
  itemRow: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderColor: '#e2e8f0',
  },
  itemTitle: {
    fontWeight: '600',
    color: '#0f172a',
  },
  itemMeta: {
    fontSize: 12,
    color: '#475569',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    textAlign: 'center',
    color: '#64748b',
  },
  error: {
    color: '#b91c1c',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  badge: {
    backgroundColor: '#16a34a',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  purchasedName: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '500',
  },
  sectionHeader: {
    paddingVertical: 12,
    marginTop: 16,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  sectionHeaderText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  packageHeader: {
    paddingVertical: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  packageHeaderText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#475569',
  },
});
