import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser } from 'aws-amplify/auth';

// Minimal query to fetch a trainer row for this user
const LIST_TRAINERS_BY_USER = /* GraphQL */ `
  query ListTrainers($user_id: ID!) {
    listTrainers(filter: { user_id: { eq: $user_id } }, limit: 1) {
      items { trainer_id user_id training_focus total_clients total_revenue workouts_sold services_sold workouts_created }
      nextToken
    }
  }
`;

const LIST_TRAINERS_SCAN = /* GraphQL */ `
  query ListTrainersScan($limit: Int) {
    listTrainers(limit: $limit) {
      items { trainer_id user_id training_focus total_clients total_revenue workouts_sold services_sold workouts_created }
      nextToken
    }
  }
`;

const GET_TRAINER = /* GraphQL */ `
  query GetTrainer($trainer_id: ID!) {
    getTrainer(trainer_id: $trainer_id) {
      trainer_id user_id training_focus total_clients total_revenue workouts_sold services_sold workouts_created
    }
  }
`;

const LIST_WORKOUTS_BY_TRAINER = /* GraphQL */ `
  query ListWorkoutsByTrainer($trainer_id: ID!, $limit: Int) {
    listWorkoutsByTrainer(trainer_id: $trainer_id, limit: $limit) {
      workout_id
    }
  }
`;

export default function TrainerDashboard({ route, navigation }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const [loading, setLoading] = useState(false);
  const [trainer, setTrainer] = useState(null);
  const [error, setError] = useState(null);
  const [workoutCount, setWorkoutCount] = useState(0);
  const trainerIdFromRoute = route?.params?.trainer_id;

  const loadTrainer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const explicitTrainerId = route?.params?.trainer_id;
      const current = await getCurrentUser();
      const user_id = current?.userId || current?.username;

      console.log('TrainerDashboard: Loading for user_id:', user_id, 'explicitTrainerId:', explicitTrainerId);

      let t = null;
      if (explicitTrainerId) {
        console.log('TrainerDashboard: trying trainer_id from route', explicitTrainerId);
        const { data } = await client.graphql({
          query: GET_TRAINER,
          variables: { trainer_id: explicitTrainerId },
        });
        t = data?.getTrainer;
        if (t) {
          console.log('TrainerDashboard: Found trainer by explicit ID:', t.trainer_id, 'owner user_id:', t.user_id);
          // Security check: ensure this trainer record belongs to the current user
          if (t.user_id !== user_id) {
            console.log('TrainerDashboard: Ownership mismatch! Explicit ID belongs to', t.user_id, 'but current user is', user_id);
            t = null;
          }
        } else {
          console.log('TrainerDashboard: No trainer found for explicit ID:', explicitTrainerId);
        }
      }

      if (!t) {
        console.log('TrainerDashboard: fetching trainer for user_id', user_id);
        const { data } = await client.graphql({
          query: LIST_TRAINERS_BY_USER,
          variables: { user_id },
        });
        const items = data?.listTrainers?.items || [];
        t = items.find(item => item.user_id === user_id) || null;
        if (t) {
          console.log('TrainerDashboard: Found trainer by user_id:', t.trainer_id);
        }
      }

      // Fallback: shallow scan and pick a matching user_id if filter failed
      if (!t) {
        console.log('TrainerDashboard: Fallback scan for user_id', user_id);
        const { data: scanData } = await client.graphql({
          query: LIST_TRAINERS_SCAN,
          variables: { limit: 50 },
        });
        const scanItems = scanData?.listTrainers?.items || [];
        t = scanItems.find((item) => item?.user_id === user_id) || null;
        if (t) {
          console.log('TrainerDashboard: Found trainer via fallback scan:', t.trainer_id);
        }
      }

      if (!t) {
        setError('No trainer record found for this user.');
        setTrainer(null);
      } else {
        setTrainer(t);
        try {
          const { data: workoutsData } = await client.graphql({
            query: LIST_WORKOUTS_BY_TRAINER,
            variables: { trainer_id: t.trainer_id, limit: 100 },
          });
          const list = workoutsData?.listWorkoutsByTrainer;
          const workouts = Array.isArray(list) ? list : Array.isArray(list?.items) ? list.items : [];
          setWorkoutCount(workouts.length);
        } catch (workErr) {
          console.log('TrainerDashboard: listWorkoutsByTrainer failed', workErr);
          setWorkoutCount(0);
        }
      }
    } catch (e) {
      setError(e?.message || 'Failed to load trainer.');
      setTrainer(null);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    loadTrainer();
  }, [loadTrainer]);

  const renderStat = (label, value) => {
    let displayValue = value ?? 0;
    if (label === 'Total Revenue') {
      displayValue = `$${Number(displayValue).toFixed(2)}`;
    }
    return (
      <View style={styles.statCard} key={label}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={styles.statValue}>{displayValue}</Text>
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.safe}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadTrainer} />}
    >
      <Text style={styles.title}>Trainer Dashboard</Text>
      {loading ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && !trainer && !error ? (
        <Text style={styles.muted}>No trainer data available.</Text>
      ) : null}
      {trainer ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Trainer Stats</Text>
          <Text style={styles.muted}>Trainer ID: {trainer.trainer_id}</Text>
          <Text style={styles.muted}>Focus: {trainer.training_focus || 'N/A'}</Text>
          <View style={{ marginTop: 12, gap: 8 }}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => {
                if (trainer?.trainer_id) {
                  navigation.navigate('WorkoutProductBuilder', { trainer_id: trainer.trainer_id });
                }
              }}
            >
              <Text style={styles.primaryButtonText}>Build Workout Product</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                if (trainer?.trainer_id) {
                  navigation.navigate('VirtualTrainingServiceBuilder', { trainer_id: trainer.trainer_id });
                }
              }}
            >
              <Text style={styles.secondaryButtonText}>Create Virtual Training Service</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.statGrid}>
            {renderStat('Workouts Created', trainer.workouts_created ?? workoutCount)}
            {renderStat('Services Sold', trainer.services_sold)}
            {renderStat('Total Clients', trainer.total_clients)}
            {renderStat('Total Revenue', trainer.total_revenue)}
            {renderStat('Workouts Sold', trainer.workouts_sold)}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  statGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    width: '47%',
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statLabel: {
    fontSize: 13,
    color: '#475569',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  muted: {
    color: '#94a3b8',
    marginTop: 6,
  },
  error: {
    color: '#b91c1c',
    marginBottom: 8,
  },
  primaryButton: {
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  secondaryButton: {
    backgroundColor: '#0f172a',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
});
