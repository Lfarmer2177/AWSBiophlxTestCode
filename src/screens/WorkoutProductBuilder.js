import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, Alert, ScrollView } from 'react-native';
import { generateClient } from 'aws-amplify/api';
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

const CREATE_WORKOUT_PRODUCT = /* GraphQL */ `
  mutation CreateWorkoutProduct($input: CreateWorkoutProductInput!) {
    createWorkoutProduct(input: $input) {
      workout_product_id
      trainer_id
    }
  }
`;

export default function WorkoutProductBuilder({ route, navigation }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const trainer_id = route?.params?.trainer_id || null;

  const [name, setName] = useState('');
  const [intensity, setIntensity] = useState('Moderate');
  const [fitnessGoal, setFitnessGoal] = useState('');
  const [price, setPrice] = useState('');
  const [workouts, setWorkouts] = useState([]);
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!trainer_id) return;
    (async () => {
      try {
        const { data } = await client.graphql({
          query: LIST_WORKOUTS_BY_TRAINER,
          variables: { trainer_id, limit: 100 },
        });
        const list = data?.listWorkoutsByTrainer;
        const items = Array.isArray(list) ? list : Array.isArray(list?.items) ? list.items : [];
        setWorkouts(items);
      } catch (err) {
        console.log('Load workouts for product failed', err);
        Alert.alert('Error', 'Unable to load workouts for this trainer.');
      }
    })();
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
      const now = new Date().toISOString();
      const workout_product_id = uuidv4();
      await client.graphql({
        query: CREATE_WORKOUT_PRODUCT,
        variables: {
          input: {
            workout_product_id,
            trainer_id,
            name: name.trim(),
            difficulty_level: intensity,
            fitness_goal: fitnessGoal || null,
            price: priceNum,
            workout_id: pickedIds,
            created_at: now,
            updated_at: now,
          },
        },
      });
      Alert.alert('Saved', 'Workout product created.', [
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
