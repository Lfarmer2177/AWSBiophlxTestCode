import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser } from 'aws-amplify/auth';
import { listWorkoutsByCustomer, listWorkoutItemsByWorkout } from '../graphql/queries';

const LIST_CUSTOMERS_BY_USER = /* GraphQL */ `
  query ListCustomers($user_id: ID!) {
    listCustomers(filter: { user_id: { eq: $user_id } }, limit: 1) {
      items { customer_id }
      nextToken
    }
  }
`;

export default function WorkoutLibrary({ navigation }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const [customerId, setCustomerId] = useState(null);
  const [workouts, setWorkouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [itemsMap, setItemsMap] = useState({});
  const [itemsLoading, setItemsLoading] = useState({});

  const fetchWorkouts = useCallback(
    async (custId) => {
      if (!custId) return;
      try {
        setLoading(true);
        setError(null);
        const { data } = await client.graphql({
          query: listWorkoutsByCustomer,
          variables: { customer_id: custId, limit: 50 },
        });
        const items = data?.listWorkoutsByCustomer ?? [];
        const normalized = (items || []).map((row) => ({
          workout_id: row.workout_id,
          name: row.name || 'Untitled Workout',
          created_at: row.created_at,
          updated_at: row.updated_at,
        }));
        setWorkouts(normalized);
      } catch (err) {
        console.log('Fetch workouts failed', err);
        setError(err?.errors?.[0]?.message || 'Failed to load workouts.');
      } finally {
        setLoading(false);
      }
    },
    [client]
  );

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
    async (workout_id) => {
      if (!workout_id || itemsMap[workout_id]) return;
      try {
        setItemsLoading((prev) => ({ ...prev, [workout_id]: true }));
        const { data } = await client.graphql({
          query: listWorkoutItemsByWorkout,
          variables: { workout_id, limit: 100 },
        });
        const rows = data?.listWorkoutItemsByWorkout ?? data?.listWorkoutItems ?? [];
        const normalized = rows
          .map(normalizeWorkoutItem)
          .sort((a, b) => (a.workout_item_index || 0) - (b.workout_item_index || 0));
        setItemsMap((prev) => ({ ...prev, [workout_id]: normalized }));
      } catch (err) {
        console.log('Workout items fetch failed', err);
        setError(err?.errors?.[0]?.message || 'Failed to load workout items.');
      } finally {
        setItemsLoading((prev) => ({ ...prev, [workout_id]: false }));
      }
    },
    [client, itemsMap]
  );

  const toggleExpand = async (workout_id) => {
    if (expandedId === workout_id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(workout_id);
    await ensureItems(workout_id);
  };

  const goToRunner = useCallback(
    async (workout) => {
      await ensureItems(workout.workout_id);
      navigation.navigate('WorkoutRunner', {
        customer_id: customerId,
        workoutPlan: {
          workout_id: workout.workout_id,
          name: workout.name,
          items: itemsMap[workout.workout_id] ?? [],
        },
      });
    },
    [customerId, navigation, ensureItems, itemsMap]
  );

  const renderWorkout = ({ item }) => {
    const isOpen = expandedId === item.workout_id;
    const itemList = itemsMap[item.workout_id] || [];
    const loadingItems = itemsLoading[item.workout_id];
    return (
      <View style={styles.card}>
        <Pressable onPress={() => toggleExpand(item.workout_id)} style={styles.cardHeader}>
          <View>
            <Text style={styles.workoutName}>{item.name}</Text>
            <Text style={styles.workoutMeta}>
              Created {formatDate(item.created_at)} · Updated {formatDate(item.updated_at)}
            </Text>
          </View>
          <TouchableOpacity style={styles.performButton} onPress={() => goToRunner(item)}>
            <Text style={styles.performText}>Perform</Text>
          </TouchableOpacity>
        </Pressable>
        {isOpen && (
          <View style={styles.itemsSection}>
            {loadingItems ? (
              <ActivityIndicator />
            ) : itemList.length === 0 ? (
              <Text style={styles.empty}>No exercises added yet.</Text>
            ) : (
              itemList.map((entry) => (
                <View key={`${entry.workout_id}-${entry.workout_item_index}`} style={styles.itemRow}>
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
        keyExtractor={(item) => item.workout_id}
        renderItem={renderWorkout}
        ListEmptyComponent={<Text style={styles.empty}>No workouts created yet.</Text>}
      />
    </SafeAreaView>
  );
}

async function resolveCustomerId(client) {
  try {
    const current = await getCurrentUser();
    const user_id = current?.userId || current?.username;
    if (!user_id) return null;
    const { data } = await client.graphql({
      query: LIST_CUSTOMERS_BY_USER,
      variables: { user_id },
    });
    return data?.listCustomers?.items?.[0]?.customer_id || null;
  } catch (error) {
    console.log('resolveCustomerId error', error);
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
});
