import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { generateClient } from 'aws-amplify/api';

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

export default function TrainerProfile({ route }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const trainer_id = route?.params?.trainer_id;
  const user_id = route?.params?.user_id;
  const [trainer, setTrainer] = useState(null);
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);

  const unwrapString = (val) => {
    if (val?.S) return val.S;
    if (typeof val === 'string') return val;
    return '';
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
      // Count direct workouts
      const workoutIds = (Array.isArray(service.workout_ids) ? service.workout_ids : []).map(unwrapString).filter(Boolean);
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
          total += items.length;
        } catch {}
      }
      // Count workouts from included workout products
      const productIds = (Array.isArray(service.workout_products) ? service.workout_products : []).map(unwrapString).filter(Boolean);
      for (const pid of productIds) {
        try {
          const { data } = await client.graphql({
            query: LIST_WORKOUT_PRODUCTS_BY_ID,
            variables: { workout_product_id: pid },
          });
          const wp = data?.getWorkoutProduct;
          const wpWorkouts = (wp?.workout_id || []).map(unwrapString).filter(Boolean);
          for (const wid of wpWorkouts) {
            let nextToken;
            do {
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
                total += items.length;
                nextToken = null;
              } catch {
                nextToken = null;
              }
            } while (nextToken);
          }
        } catch {}
      }
      return total;
    },
    [client]
  );

  useEffect(() => {
    (async () => {
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
        if (trainer_id) {
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
            const { data } = await client.graphql({
              query: LIST_SERVICES,
              variables: { trainer_id, limit: 50 },
            });
            const raw = data?.listVirtualTrainingServicesByTrainer;
            const items = Array.isArray(raw?.items) ? raw.items : [];
            const enriched = [];
            for (const svc of items) {
              const exCount = await countExercisesForService(svc).catch(() => 0);
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
    })();
  }, [client, trainer_id, user_id, loadCountsForProduct]);

  const renderProduct = ({ item }) => (
    <View style={styles.productCard}>
      <Text style={styles.productName}>{item.name}</Text>
      <Text style={styles.meta}>Intensity: {item.difficulty_level || 'N/A'}</Text>
      <Text style={styles.meta}>Goal: {item.fitness_goal || 'N/A'}</Text>
      <Text style={styles.meta}>Exercises: {item.exerciseCount ?? 0}</Text>
      <Text style={styles.meta}>Price: ${item.price ?? 0}</Text>
      <TouchableOpacity
        style={styles.buyButton}
        onPress={() => Alert.alert('Purchase', 'Purchase flow coming soon.')}
      >
        <Text style={styles.buyButtonText}>Purchase</Text>
      </TouchableOpacity>
    </View>
  );

  const renderService = ({ item }) => (
    <View style={styles.productCard}>
      <Text style={styles.productName}>{item.service_name}</Text>
      <Text style={styles.meta}>Duration: {item.duration_weeks ?? 'N/A'} weeks</Text>
      <Text style={styles.meta}>Exercises: {item.exerciseCount ?? 0}</Text>
      <Text style={styles.meta}>Price: ${item.price ?? 0}</Text>
      <Text style={styles.meta}>Workouts: {(item.workout_ids || []).length}</Text>
      <Text style={styles.meta}>Workout products: {(item.workout_products || []).length}</Text>
    </View>
  );

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
          {services.length ? (
            services.map((svc) => <View key={svc.service_id}>{renderService({ item: svc })}</View>)
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
  buyButtonText: {
    color: '#fff',
    fontWeight: '700',
    textAlign: 'center',
  },
});
