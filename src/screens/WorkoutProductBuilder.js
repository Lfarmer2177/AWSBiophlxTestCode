import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, Alert, ScrollView } from 'react-native';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser } from 'aws-amplify/auth';
import { v4 as uuidv4 } from 'uuid';

const LIST_WORKOUTS_BY_TRAINER = /* GraphQL */ `
  query ListWorkoutsByTrainer($trainer_id: ID!, $limit: Int) {
    listWorkoutsByTrainer(trainer_id: $trainer_id, limit: $limit) {
      workout_id
      name
      created_at
    }
  }
`;

const LIST_WORKOUTS_BY_CUSTOMER = /* GraphQL */ `
  query ListWorkoutsByCustomer($customer_id: ID!, $limit: Int) {
    listWorkoutsByCustomer(customer_id: $customer_id, limit: $limit) {
      workout_id
      name
      created_at
    }
  }
`;

const LIST_CUSTOMERS_BY_USER = /* GraphQL */ `
  query ListCustomers($user_id: ID!) {
    listCustomers(filter: { user_id: { eq: $user_id } }, limit: 1) {
      items { customer_id }
    }
  }
`;

const CREATE_WORKOUT_PRODUCT = /* GraphQL */ `
  mutation CreateWorkoutProduct($input: CreateWorkoutProductInput!) {
    createWorkoutProduct(input: $input) {
      workout_product_id
      trainer_id
      stripe_product_id
      stripe_price_id
    }
  }
`;

const CREATE_STRIPE_PRODUCT = /* GraphQL */ `
  mutation CreateStripeProduct(
    $trainer_id: ID!, 
    $name: String!, 
    $price: Float!, 
    $description: String, 
    $product_type: String,
    $workout_ids: [ID],
    $difficulty_level: String,
    $fitness_goal: String
  ) {
    createStripeProduct(
      trainer_id: $trainer_id, 
      name: $name, 
      price: $price, 
      description: $description, 
      product_type: $product_type,
      workout_ids: $workout_ids,
      difficulty_level: $difficulty_level,
      fitness_goal: $fitness_goal
    ) {
      workout_product_id
      stripe_product_id
      stripe_price_id
      error
    }
  }
`;

export default function WorkoutProductBuilder({ route, navigation }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const trainer_id = route?.params?.trainer_id || null;

  useEffect(() => {
    console.log('WorkoutProductBuilder: Mounted with trainer_id:', trainer_id);
  }, [trainer_id]);

  const [name, setName] = useState('');
  const [intensity, setIntensity] = useState('Moderate');
  const [fitnessGoal, setFitnessGoal] = useState('');
  const [price, setPrice] = useState('');
  const [workouts, setWorkouts] = useState([]);
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!trainer_id) return;
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        // 1. Fetch by trainer_id
        const trainerRes = await client.graphql({
          query: LIST_WORKOUTS_BY_TRAINER,
          variables: { trainer_id, limit: 100 },
        }).catch(() => ({ data: {} }));
        
        // 2. Fetch by customer_id (current user)
        let customerRes = { data: {} };
        try {
          const user = await getCurrentUser();
          const userId = user.userId || user.username;

          // Resolve correct customer_id
          let resolvedCustomerId = userId;
          try {
             const custData = await client.graphql({
               query: LIST_CUSTOMERS_BY_USER,
               variables: { user_id: userId }
             });
             const found = custData?.data?.listCustomers?.items?.[0]?.customer_id;
             if (found) resolvedCustomerId = found;
             console.log('Resolved customer ID for workouts:', resolvedCustomerId);
          } catch (err) {
             console.log('Error resolving customer ID:', err);
          }

          customerRes = await client.graphql({
            query: LIST_WORKOUTS_BY_CUSTOMER,
            variables: { customer_id: resolvedCustomerId, limit: 100 },
          });
        } catch (e) {
          console.log('Failed to fetch user workouts:', e);
        }

        if (mounted) {
          const trainerList = trainerRes?.data?.listWorkoutsByTrainer?.items || trainerRes?.data?.listWorkoutsByTrainer || [];
          const customerList = customerRes?.data?.listWorkoutsByCustomer?.items || customerRes?.data?.listWorkoutsByCustomer || [];
          
          // Merge and dedup
          const all = [...trainerList, ...customerList];
          const unique = [];
          const seen = new Set();
          for (const w of all) {
            if (w?.workout_id && !seen.has(w.workout_id)) {
              seen.add(w.workout_id);
              unique.push(w);
            }
          }
          
          // Sort by creation date (newest first)
          unique.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
          
          setWorkouts(unique);
        }
      } catch (err) {
        console.log('Load workouts for product failed', err);
        Alert.alert('Error', 'Unable to load workouts for this trainer.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [client, trainer_id]);

  const toggleWorkout = (workout_id) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[workout_id]) {
        delete next[workout_id];
      } else {
        next[workout_id] = true;
      }
      return next;
    });
  };

  const saveProduct = async () => {
    if (!trainer_id) {
      Alert.alert('Missing trainer', 'Trainer ID is required to create a product.');
      return;
    }
    const pickedIds = Object.keys(selected);
    if (!pickedIds.length) {
      Alert.alert('Select workouts', 'Pick at least one workout to include in this product.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Name required', 'Enter a product name.');
      return;
    }
    const priceNum = parseFloat(price);
    if (Number.isNaN(priceNum) || priceNum < 0) {
      Alert.alert('Invalid price', 'Enter a valid price in USD.');
      return;
    }
    try {
      setLoading(true);

      // 1. Backend handles both Stripe Sync AND DynamoDB record creation
      console.log('Initiating product sync with variables:', {
        trainer_id: trainer_id,
        name: name.trim(),
        price: priceNum,
        product_type: 'workout_product',
        workout_ids: pickedIds
      });

      const stripeRes = await client.graphql({
        query: CREATE_STRIPE_PRODUCT,
        variables: {
          trainer_id: trainer_id,
          name: name.trim(),
          price: priceNum,
          description: `Intensity: ${intensity}, Goal: ${fitnessGoal}`,
          product_type: 'workout_product',
          workout_ids: pickedIds,
          difficulty_level: intensity,
          fitness_goal: fitnessGoal || null
        }
      });

      console.log('Full Stripe Sync Response:', JSON.stringify(stripeRes, null, 2));

      const stripeData = stripeRes.data?.createStripeProduct;
      
      if (!stripeData) {
        throw new Error('No data returned from createStripeProduct mutation.');
      }

      if (stripeData.error) {
        throw new Error(`Sync Error: ${stripeData.error}`);
      }

      if (!stripeData.stripe_product_id) {
        throw new Error(`Incomplete sync: Product created but Stripe ID is missing. Data: ${JSON.stringify(stripeData)}`);
      }

      Alert.alert('Saved', 'Workout product created and synced successfully.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      console.log('Create workout product failed', err);
      Alert.alert('Error', err?.errors?.[0]?.message || 'Failed to create product.');
    } finally {
      setLoading(false);
    }
  };

  const renderWorkout = ({ item }) => {
    const checked = !!selected[item.workout_id];
    return (
      <TouchableOpacity
        onPress={() => toggleWorkout(item.workout_id)}
        style={[styles.workoutRow, checked && styles.workoutRowChecked]}
      >
        <Text style={styles.workoutName}>{item.name || item.workout_id}</Text>
        <Text style={styles.workoutMeta}>{item.created_at || ''}</Text>
        <Text style={styles.checkbox}>{checked ? '✓ Included' : 'Tap to include'}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Build Workout Product</Text>
      <Text style={styles.muted}>Trainer ID: {trainer_id || 'N/A'}</Text>

      <Text style={styles.label}>Product Name</Text>
      <TextInput
        style={styles.input}
        placeholder="E.g. 4-week Strength Pack"
        value={name}
        onChangeText={setName}
      />

      <Text style={styles.label}>Intensity</Text>
      <View style={styles.chipRow}>
        {['Light', 'Moderate', 'Intense'].map((opt) => (
          <TouchableOpacity
            key={opt}
            onPress={() => setIntensity(opt)}
            style={[styles.chip, intensity === opt && styles.chipActive]}
          >
            <Text style={[styles.chipText, intensity === opt && styles.chipTextActive]}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Fitness Goal</Text>
      <TextInput
        style={styles.input}
        placeholder="E.g. Build Muscle, Endurance"
        value={fitnessGoal}
        onChangeText={setFitnessGoal}
      />

      <Text style={styles.label}>Price (USD)</Text>
      <TextInput
        style={styles.input}
        placeholder="0.00"
        keyboardType="decimal-pad"
        value={price}
        onChangeText={setPrice}
      />

      <Text style={styles.label}>Select Workouts to include</Text>
      {workouts.length === 0 ? (
        <Text style={styles.muted}>No workouts found for this trainer.</Text>
      ) : (
        <FlatList
          data={workouts}
          keyExtractor={(item) => item.workout_id}
          renderItem={renderWorkout}
          scrollEnabled={false}
        />
      )}

      <TouchableOpacity
        style={[styles.saveButton, loading && { opacity: 0.6 }]}
        disabled={loading}
        onPress={saveProduct}
      >
        <Text style={styles.saveButtonText}>{loading ? 'Saving...' : 'Save Product'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  muted: {
    color: '#94a3b8',
  },
  label: {
    marginTop: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 12,
    marginTop: 6,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  chipActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  chipText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#fff',
  },
  workoutRow: {
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    marginTop: 8,
  },
  workoutRowChecked: {
    borderColor: '#2563eb',
    backgroundColor: '#e0ecff',
  },
  workoutName: {
    fontWeight: '700',
  },
  workoutMeta: {
    color: '#64748b',
    fontSize: 12,
  },
  checkbox: {
    marginTop: 4,
    color: '#0f172a',
    fontWeight: '600',
  },
  saveButton: {
    marginTop: 16,
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 12,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
});
