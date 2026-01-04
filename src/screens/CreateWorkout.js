import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { generateClient } from 'aws-amplify/api';
import { v4 as uuidv4 } from 'uuid';
import { listExercises } from '../graphql/queries';
import { createWorkout, createWorkoutItem } from '../graphql/mutations';

const LIST_TRAINERS_BY_USER = /* GraphQL */ `
  query ListTrainers($user_id: ID!) {
    listTrainers(filter: { user_id: { eq: $user_id } }, limit: 1) {
      items { trainer_id user_id }
      nextToken
    }
  }
`;

const INTENSITY_PRESETS = {
  easy: { label: 'Easy', tut: 1.0, velocity: 1.3 },
  moderate: { label: 'Moderate', tut: 3.0, velocity: 0.75 },
  intense: { label: 'Intense', tut: 5.0, velocity: 0.5 },
};

export default function CreateWorkout({ route, navigation }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const { customer_id, trainer_id: trainerIdFromRoute } = route.params ?? {};

  const [workoutName, setWorkoutName] = useState('');
  const [exercises, setExercises] = useState([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await client.graphql({ query: listExercises, variables: { limit: 200 } });
        const source = data?.listExercises?.items ?? data?.listExercises ?? [];
        if (mounted) {
          const normalized = source
            .filter((ex) => ex?.exercise_id)
            .map(normalizeExercise);
          normalized.sort((a, b) => a.name.localeCompare(b.name));
          setExercises(normalized);
        }
      } catch (error) {
        console.log('Exercise fetch failed', error);
        Alert.alert('Error', 'Failed to load exercises. Please try again.');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [client]);

  const addExercise = useCallback(
    (exercise) => {
      if (!exercise) return;
      setItems((prev) => [
        ...prev,
        {
          tempId: uuidv4(),
          exercise_id: exercise.exercise_id,
          name: exercise.name,
          category: exercise.category,
          target_sets: '3',
          target_reps: '10',
          target_weight: '',
          intensity: 'moderate',
        },
      ]);
      setPickerVisible(false);
    },
    []
  );

  const updateItem = (id, key, value) => {
    setItems((prev) => prev.map((entry) => (entry.tempId === id ? { ...entry, [key]: value } : entry)));
  };

  const removeItem = (id) => {
    setItems((prev) => prev.filter((entry) => entry.tempId !== id));
  };

  const saveWorkout = async () => {
    if (!customer_id) {
      Alert.alert('Missing info', 'Unable to resolve customer profile.');
      return;
    }
    if (!items.length) {
      Alert.alert('No exercises', 'Add at least one exercise.');
      return;
    }
    try {
      setSaving(true);
      const now = new Date().toISOString();
      const workout_id = uuidv4();
      const name = workoutName.trim() || `Workout ${new Date().toLocaleDateString()}`;
      let trainer_id = trainerIdFromRoute || null;
      if (!trainer_id) {
        try {
          const current = await getCurrentUser();
          const user_id = current?.userId || current?.username;
          const { data } = await client.graphql({
            query: LIST_TRAINERS_BY_USER,
            variables: { user_id },
          });
          trainer_id = data?.listTrainers?.items?.[0]?.trainer_id || null;
        } catch (err) {
          console.log('Resolve trainer_id failed', err);
        }
      }

      await client.graphql({
        query: createWorkout,
        variables: { input: { workout_id, customer_id, trainer_id: trainer_id || null, name, created_at: now, updated_at: now } },
      });

      const mutations = items.map((entry, index) => {
        const preset = INTENSITY_PRESETS[entry.intensity] || INTENSITY_PRESETS.moderate;
        const setsNum = parseInt(entry.target_sets, 10) || 0;
        const repsNum = parseInt(entry.target_reps, 10) || 0;
        const weightNum = parseFloat(entry.target_weight) || 0;
        return client.graphql({
          query: createWorkoutItem,
          variables: {
            input: {
              workout_id,
              workout_item_index: index + 1,
              exercise_id: entry.exercise_id,
              muscle_focus: entry.category,
              target_sets: setsNum,
              target_reps: repsNum,
              target_tot: setsNum * repsNum,
              target_velocity: preset.velocity,
              target_tut: preset.tut,
              target_weight: weightNum,
              created_at: now,
              updated_at: now,
            },
          },
        });
      });

      await Promise.all(mutations);
      Alert.alert('Workout saved', 'Your workout has been created.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      console.log('Save workout failed', error);
      Alert.alert('Error', error?.errors?.[0]?.message || 'Failed to save workout.');
    } finally {
      setSaving(false);
    }
  };

  const renderSelectedItem = ({ item, index }) => {
    const preset = INTENSITY_PRESETS[item.intensity] || INTENSITY_PRESETS.moderate;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardTitle}>{index + 1}. {item.name}</Text>
            <Text style={styles.cardSubtitle}>{item.category}</Text>
          </View>
          <Pressable onPress={() => removeItem(item.tempId)}>
            <Text style={styles.remove}>Remove</Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Target Sets</Text>
            <TextInput
              keyboardType="numeric"
              value={item.target_sets}
              onChangeText={(text) => updateItem(item.tempId, 'target_sets', text)}
              style={styles.input}
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Target Reps</Text>
            <TextInput
              keyboardType="numeric"
              value={item.target_reps}
              onChangeText={(text) => updateItem(item.tempId, 'target_reps', text)}
              style={styles.input}
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Target Weight</Text>
            <TextInput
              keyboardType="numeric"
              value={item.target_weight}
              onChangeText={(text) => updateItem(item.tempId, 'target_weight', text)}
              style={styles.input}
              placeholder="lbs"
            />
          </View>
        </View>

        <View style={styles.intensityRow}>
          {Object.entries(INTENSITY_PRESETS).map(([key, presetInfo]) => {
            const active = item.intensity === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => updateItem(item.tempId, 'intensity', key)}
                style={[styles.intensityPill, active && styles.intensityPillActive]}
              >
                <Text style={[styles.intensityText, active && styles.intensityTextActive]}>
                  {presetInfo.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.meta}>
          Target TUT: {preset.tut.toFixed(2)} sec · Target Velocity: {preset.velocity.toFixed(2)} m/s
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.heading}>Create Workout</Text>
        <TextInput
          style={styles.nameInput}
          placeholder="Workout name"
          value={workoutName}
          onChangeText={setWorkoutName}
        />

        <TouchableOpacity style={styles.addButton} onPress={() => setPickerVisible(true)}>
          <Text style={styles.addButtonText}>+ Add Exercise</Text>
        </TouchableOpacity>

        {items.length === 0 ? (
          <Text style={styles.empty}>Add exercises to begin building your workout.</Text>
        ) : (
          <FlatList
            data={items}
            renderItem={renderSelectedItem}
            keyExtractor={(item) => item.tempId}
            scrollEnabled={false}
          />
        )}

        <TouchableOpacity style={[styles.saveButton, (!items.length || saving) && styles.saveButtonDisabled]} onPress={saveWorkout} disabled={!items.length || saving}>
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Workout'}</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={pickerVisible} animationType="slide">
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Exercise</Text>
            <Pressable onPress={() => setPickerVisible(false)}>
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          <FlatList
            data={exercises}
            keyExtractor={(item) => item.exercise_id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.exerciseRow} onPress={() => addExercise(item)}>
                <View>
                  <Text style={styles.exerciseName}>{item.name}</Text>
                  <Text style={styles.exerciseCategory}>{item.category}</Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const normalizeExercise = (raw) => {
  const exercise_id = unwrap(raw?.exercise_id);
  return {
    exercise_id,
    name: unwrap(raw?.name) || exercise_id || 'Unknown exercise',
    category: unwrap(raw?.category) || 'General',
  };
};

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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#f7f7fb',
  },
  container: {
    padding: 16,
    paddingBottom: 40,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 14,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    backgroundColor: '#fff',
  },
  addButton: {
    backgroundColor: '#e0e7ff',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 18,
  },
  addButtonText: {
    fontWeight: '600',
    color: '#4338ca',
  },
  empty: {
    textAlign: 'center',
    color: '#6b7280',
    marginTop: 10,
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#6b7280',
  },
  remove: {
    color: '#b91c1c',
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  inputGroup: {
    flex: 1,
  },
  label: {
    fontSize: 12,
    marginBottom: 4,
    color: '#6b7280',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#fafafa',
  },
  intensityRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  intensityPill: {
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 40,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  intensityPillActive: {
    backgroundColor: '#4338ca',
    borderColor: '#4338ca',
  },
  intensityText: {
    color: '#4338ca',
    fontWeight: '600',
  },
  intensityTextActive: {
    color: '#fff',
  },
  meta: {
    fontSize: 12,
    color: '#4b5563',
  },
  saveButton: {
    marginTop: 12,
    backgroundColor: '#16a34a',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: '#94a3b8',
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  modalSafe: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderColor: '#e4e4e7',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  close: {
    color: '#b91c1c',
    fontWeight: '600',
  },
  exerciseRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#f1f5f9',
  },
  exerciseName: {
    fontSize: 16,
    fontWeight: '600',
  },
  exerciseCategory: {
    color: '#6b7280',
    marginTop: 2,
  },
});
