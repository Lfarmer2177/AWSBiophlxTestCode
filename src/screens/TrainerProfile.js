import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Image, FlatList, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Linking, RefreshControl } from 'react-native';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser } from 'aws-amplify/auth';
import { listPermissionsByUser } from '../graphql/queries';

const GET_TRAINER = /* GraphQL */ `
  query GetTrainer($trainer_id: ID!) {
    getTrainer(trainer_id: $trainer_id) {
      trainer_id user_id training_focus total_clients total_revenue services_sold workouts_sold
    }
  }
`;

const GET_USER = /* GraphQL */ `
  query GetUser($user_id: ID!) {
    getUser(user_id: $user_id) { user_id bio first_name last_name city state }
  }
`;

const LIST_PRODUCTS = /* GraphQL */ `
  query ListWorkoutProductsByTrainer($trainer_id: ID!, $limit: Int) {
    listWorkoutProductsByTrainer(trainer_id: $trainer_id, limit: $limit) {
      workout_product_id
      name
      difficulty_level
      fitness_goal
      price
      workout_id
    }
  }
`;

const LIST_SERVICES = /* GraphQL */ `
  query ListVirtualTrainingServicesByTrainer($trainer_id: ID!, $limit: Int) {
    listVirtualTrainingServicesByTrainer(trainer_id: $trainer_id, limit: $limit) {
      items {
        service_id
        service_name
        description
        duration_weeks
        price
        workout_ids
        workout_products
      }
      nextToken
    }
  }
`;

// Temporary debugging query to check if data exists at all
const DEBUG_LIST_ALL_SERVICES = /* GraphQL */ `
  query DebugListAllServices {
    listVirtualTrainingServicesByTrainer(trainer_id: "DUMMY", limit: 100) {
      items {
        service_id
        trainer_id
        service_name
      }
    }
  }
`;

const LIST_WORKOUT_PRODUCTS_BY_ID = /* GraphQL */ `
  query GetWorkoutProduct($workout_product_id: ID!) {
    getWorkoutProduct(workout_product_id: $workout_product_id) {
      workout_product_id
      workout_id
    }
  }
`;

const LIST_WORKOUT_ITEMS = /* GraphQL */ `
  query ListWorkoutItems($workout_id: ID!, $limit: Int, $nextToken: String) {
    listWorkoutItems(workout_id: $workout_id, limit: $limit, nextToken: $nextToken) {
      workout_item_index
    }
  }
`;



import * as WebBrowser from 'expo-web-browser';

// Mutation to trigger the client's biophlx-stripe-handler for checkout
const CREATE_CHECKOUT_SESSION = /* GraphQL */ `
  mutation CreateCheckoutSession($trainer_id: ID!, $trainer_user_id: ID!, $price: Float!, $product_name: String!, $product_id: ID!, $product_type: String!, $user_id: ID!) {
    createStripeCheckout(
      trainer_id: $trainer_id, 
      trainer_user_id: $trainer_user_id,
      price: $price, 
      product_name: $product_name, 
      product_id: $product_id, 
      product_type: $product_type,
      user_id: $user_id
    ) {
      url
      error
    }
  }
`;

const unwrapString = (val) => {
  if (!val) return '';
  if (val?.S) return val.S;
  if (val?.N) return val.N;
  if (typeof val === 'string' || typeof val === 'number') return val;
  return '';
};

const unwrapList = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(unwrapString).filter(Boolean);
  if (val?.L && Array.isArray(val.L)) return val.L.map(unwrapString).filter(Boolean);
  return [];
};

export default function TrainerProfile({ route, navigation }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const { trainer_id, user_id } = route.params || {};
  const [trainer, setTrainer] = useState(null);
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(null);
  const [purchasedProductIds, setPurchasedProductIds] = useState(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const loadPermissions = useCallback(async () => {
    try {
      const current = await getCurrentUser();
      const buyer_id = current?.userId || current?.username;
      
      if (buyer_id) {
        const { data: permData } = await client.graphql({
          query: listPermissionsByUser,
          variables: { 
            user_id: buyer_id,
            limit: 100
          }
        });
        
        const perms = permData?.listPermissionsByUser?.items || [];
        console.log('TrainerProfile: Found permissions:', perms.length);
        
        const ownedIds = new Set();
        perms.forEach(p => {
          const resId = unwrapString(p.resource_id);
          const status = unwrapString(p.status);
          if (status === 'active') {
            ownedIds.add(resId);
          }
        });
        
        setPurchasedProductIds(ownedIds);
      }
    } catch (permErr) {
      console.log('TrainerProfile: Failed to fetch user permissions', permErr);
    }
  }, [client]);

  const handlePurchase = async (item, type) => {
    const itemId = item.workout_product_id || item.service_id;
    if (purchasing) return;
    setPurchasing(itemId);
    try {
      // 1. Validate inputs
      if (!trainer_id || !item.price) {
        Alert.alert('Error', 'Invalid product or price.');
        return;
      }

      // 2. Call Backend to create Stripe Session
      const res = await client.graphql({
        query: CREATE_CHECKOUT_SESSION,
        variables: {
          trainer_id: trainer_id,
          trainer_user_id: user_id, // The trainer's user_id from route params
          price: parseFloat(item.price),
          product_name: item.name || item.service_name,
          product_id: itemId,
          product_type: type, // 'workout_product' or 'service'
          user_id: (await getCurrentUser()).userId // The buyer's user ID for the webhook
        }
      });

      console.log('Stripe Response:', res);

      const response = res.data?.createStripeCheckout;

      if (!response) {
        throw new Error('No response from server. Check if AppSync mutation is linked to Lambda.');
      }

      const { url, error } = response;

      if (error) throw new Error(error);

      // 3. Redirect to Stripe
      if (url) {
        console.log('TrainerProfile: Opening Stripe URL in-app browser:', url);
        
        // Using WebBrowser to keep the user inside the app
        const result = await WebBrowser.openBrowserAsync(url, {
          dismissButtonStyle: 'close',
          readerMode: false,
          enableBarCollapsing: false,
        });

        // 4. Handle return/success after browser is closed
        // Always re-fetch permissions just in case
        await loadPermissions();

        if (result.type === 'cancel' || result.type === 'dismiss') {
          Alert.alert(
            'Purchase Completed',
            'Thank you for your purchase! Your content will be available in your library shortly.',
            [{ text: 'OK' }]
          );
        }
      }

    } catch (err) {
      console.error('Purchase failed:', err);
      Alert.alert('Error', err.message || 'Failed to initiate purchase.');
    } finally {
      setPurchasing(null);
    }
  };

  const loadCountsForProduct = useCallback(
    async (product) => {
      let totalExercises = 0;
      const workoutIdsRaw = Array.isArray(product.workout_id) ? product.workout_id : [];
      const workoutIds = workoutIdsRaw.map(unwrapString).filter(Boolean);
      for (const wid of workoutIds) {
        try {
          const { data } = await client.graphql({
            query: LIST_WORKOUT_ITEMS,
            variables: { workout_id: wid, limit: 200 },
          });
          const items = Array.isArray(data?.listWorkoutItems)
            ? data.listWorkoutItems
            : Array.isArray(data?.listWorkoutItems?.items)
            ? data.listWorkoutItems.items
            : [];
          totalExercises += items.length;
        } catch (err) {
          console.log('listWorkoutItems failed for workout_id', wid, err?.errors?.[0]?.message || err?.message || String(err));
        }
      }
      return totalExercises;
    },
    [client]
  );

  const countExercisesForService = useCallback(
    async (service) => {
      let total = 0;
      const sId = unwrapString(service.service_id);
      
      // Count direct workouts
      const workoutIds = unwrapList(service.workout_ids);
      console.log(`TrainerProfile: Service ${sId} has ${workoutIds.length} direct workout_ids`);
      
      for (const wid of workoutIds) {
        try {
          const { data } = await client.graphql({
            query: LIST_WORKOUT_ITEMS,
            variables: { workout_id: wid, limit: 200 },
          });
          const items = Array.isArray(data?.listWorkoutItems)
            ? data.listWorkoutItems
            : Array.isArray(data?.listWorkoutItems?.items)
            ? data.listWorkoutItems.items
            : [];
          console.log(`TrainerProfile: Workout ${wid} has ${items.length} items`);
          total += items.length;
        } catch (err) {
          console.log(`TrainerProfile: Failed to list items for workout ${wid}`, err);
        }
      }
      
      // Count workouts from included workout products
      const productIds = unwrapList(service.workout_products);
      console.log(`TrainerProfile: Service ${sId} has ${productIds.length} workout_products`);
      
      for (const pid of productIds) {
        try {
          const { data } = await client.graphql({
            query: LIST_WORKOUT_PRODUCTS_BY_ID,
            variables: { workout_product_id: pid },
          });
          const wp = data?.getWorkoutProduct;
          if (!wp) {
            console.log(`TrainerProfile: Workout product ${pid} not found`);
            continue;
          }
          const wpWorkouts = unwrapList(wp?.workout_id);
          console.log(`TrainerProfile: Workout product ${pid} has ${wpWorkouts.length} workouts`);
          
          for (const wid of wpWorkouts) {
            try {
              const { data } = await client.graphql({
                query: LIST_WORKOUT_ITEMS,
                variables: { workout_id: wid, limit: 200 },
              });
              const items = Array.isArray(data?.listWorkoutItems?.items)
                ? data.listWorkoutItems.items
                : Array.isArray(data?.listWorkoutItems)
                ? data.listWorkoutItems
                : [];
              console.log(`TrainerProfile: WP Workout ${wid} has ${items.length} items`);
              total += items.length;
            } catch (err) {
              console.log(`TrainerProfile: Failed to list items for WP workout ${wid}`, err);
            }
          }
        } catch (err) {
          console.log(`TrainerProfile: Failed to fetch workout product ${pid}`, err);
        }
      }
      return total;
    },
    [client]
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      if (trainer_id) {
        const { data } = await client.graphql({ query: GET_TRAINER, variables: { trainer_id } });
        setTrainer(data?.getTrainer || null);
      }
      if (user_id) {
        const { data } = await client.graphql({ query: GET_USER, variables: { user_id } });
        setUser(data?.getUser || null);
      }

      // Load current user's permissions to check for existing purchases
      await loadPermissions();

      if (trainer_id) {
        console.log('TrainerProfile: Loading data for trainer_id:', trainer_id);
        try {
          const { data } = await client.graphql({
            query: LIST_PRODUCTS,
            variables: { trainer_id, limit: 50 },
          });
          const items = Array.isArray(data?.listWorkoutProductsByTrainer)
            ? data.listWorkoutProductsByTrainer
            : data?.listWorkoutProductsByTrainer?.items || [];
          const withCounts = [];
          for (const p of items) {
            const count = await loadCountsForProduct(p).catch((err) => {
              console.log('loadCountsForProduct failed', err);
              return 0;
            });
            withCounts.push({ ...p, exerciseCount: count });
          }
          setProducts(withCounts);
        } catch (prodErr) {
          console.log('listWorkoutProductsByTrainer failed', prodErr);
          setProducts([]);
        }
        // Load virtual training services
        try {
          console.log('TrainerProfile: Fetching services for trainer_id:', trainer_id);
          const { data, errors } = await client.graphql({
            query: LIST_SERVICES,
            variables: { trainer_id, limit: 50 },
          });
          if (errors) {
            console.log('TrainerProfile: listVirtualTrainingServicesByTrainer GraphQL errors:', JSON.stringify(errors, null, 2));
          }
          const raw = data?.listVirtualTrainingServicesByTrainer;
          const items = Array.isArray(raw) ? raw : (raw?.items || []);
          console.log('TrainerProfile: listVirtualTrainingServicesByTrainer items:', JSON.stringify(items, null, 2));
          
          const enriched = [];
          for (const svc of items) {
            const exCount = await countExercisesForService(svc).catch((err) => {
              console.log('TrainerProfile: countExercisesForService failed for', unwrapString(svc.service_id), err);
              return 0;
            });
            enriched.push({ ...svc, exerciseCount: exCount });
          }
          setServices(enriched);
        } catch (svcErr) {
          console.log('listVirtualTrainingServicesByTrainer failed', svcErr);
          setServices([]);
        }
      }
    } catch (err) {
      console.log('TrainerProfile load failed', err);
    } finally {
      setLoading(false);
    }
  }, [client, trainer_id, user_id, loadCountsForProduct, countExercisesForService, loadPermissions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const renderProduct = ({ item }) => {
    const itemId = unwrapString(item.workout_product_id);
    const name = unwrapString(item.name);
    const difficulty = unwrapString(item.difficulty_level);
    const goal = unwrapString(item.fitness_goal);
    const price = unwrapString(item.price);
    const isPurchased = purchasedProductIds.has(itemId);
    return (
      <View style={styles.productCard}>
        <Text style={styles.productName}>{name}</Text>
        <Text style={styles.meta}>Intensity: {difficulty || 'N/A'}</Text>
        <Text style={styles.meta}>Goal: {goal || 'N/A'}</Text>
        <Text style={styles.meta}>Exercises: {item.exerciseCount ?? 0}</Text>
        <Text style={styles.meta}>Price: ${price ?? 0}</Text>
        <TouchableOpacity
          style={[styles.buyButton, isPurchased && styles.purchasedButton]}
          onPress={() => !isPurchased && handlePurchase(item, 'workout')}
          disabled={purchasing !== null || isPurchased}
        >
          <Text style={styles.buyButtonText}>
            {purchasing === itemId ? 'Processing...' : (isPurchased ? 'Purchased' : 'Purchase')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderService = ({ item }) => {
    const itemId = unwrapString(item.service_id);
    const name = unwrapString(item.service_name);
    const duration = unwrapString(item.duration_weeks);
    const price = unwrapString(item.price);
    const isPurchased = purchasedProductIds.has(itemId);
    
    const workoutIds = unwrapList(item.workout_ids);
    const workoutProducts = unwrapList(item.workout_products);

    return (
      <View style={styles.productCard}>
        <Text style={styles.productName}>{name}</Text>
        <Text style={styles.meta}>Duration: {duration ?? 'N/A'} weeks</Text>
        <Text style={styles.meta}>Exercises: {item.exerciseCount ?? 0}</Text>
        <Text style={styles.meta}>Price: ${price ?? 0}</Text>
        <Text style={styles.meta}>Workouts: {workoutIds.length}</Text>
        <Text style={styles.meta}>Workout products: {workoutProducts.length}</Text>
        <TouchableOpacity
          style={[styles.buyButton, isPurchased && styles.purchasedButton]}
          onPress={() => !isPurchased && handlePurchase(item, 'service')}
          disabled={purchasing !== null || isPurchased}
        >
          <Text style={styles.buyButtonText}>
            {purchasing === itemId ? 'Processing...' : (isPurchased ? 'Purchased' : 'Purchase')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Loading trainer...</Text>
      </View>
    );
  }

  if (!trainer) {
    return (
      <View style={styles.center}>
        <Text>Trainer not found.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={products}
      keyExtractor={(item) => item.workout_product_id}
      renderItem={renderProduct}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Trainer Profile</Text>
          <Text style={styles.meta}>
            {user?.first_name || ''} {user?.last_name || ''}
          </Text>
          <Text style={styles.meta}>
            {user?.city || ''}{user?.city && user?.state ? ', ' : ''}{user?.state || ''}
          </Text>
          <Text style={styles.meta}>Bio: {user?.bio || 'N/A'}</Text>
          <Text style={styles.meta}>Focus: {trainer.training_focus || 'N/A'}</Text>
          <Text style={[styles.title, { marginTop: 16 }]}>Virtual Training Services</Text>
          <Text style={{ fontSize: 10, color: '#999' }}>Trainer ID: {trainer_id}</Text>
          {services.length ? (
            services.map((svc) => (
              <View key={unwrapString(svc.service_id)}>
                {renderService({ item: svc })}
              </View>
            ))
          ) : (
            <Text style={styles.meta}>No virtual training services yet.</Text>
          )}
          <Text style={[styles.title, { marginTop: 16 }]}>Workout Products</Text>
        </View>
      }
      contentContainerStyle={products.length ? styles.list : styles.center}
      ListEmptyComponent={<Text>No workout products yet.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  header: {
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  meta: {
    color: '#475569',
    marginTop: 4,
  },
  list: {
    padding: 16,
    gap: 10,
  },
  productCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  productName: {
    fontWeight: '700',
    fontSize: 16,
  },
  buyButton: {
    marginTop: 8,
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    borderRadius: 10,
  },
  purchasedButton: {
    backgroundColor: '#059669', // Emerald/Green color
  },
  buyButtonText: {
    color: '#fff',
    fontWeight: '700',
    textAlign: 'center',
  },
});
