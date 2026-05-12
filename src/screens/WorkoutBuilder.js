import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Button, TouchableOpacity } from 'react-native';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser } from 'aws-amplify/auth';
import { v4 as uuid } from 'uuid';
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

// Create client after Amplify has been configured
let client;

export default function WorkoutBuilder({ route, navigation }) {
  client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const { customer_id, trainer_id: trainerIdFromRoute } = route.params;
  const [exercises, setExercises] = useState([]);
  const [picked, setPicked] = useState([]);

  useEffect(() => {
    (async () => {
      const { data } = await client.graphql({ query: listExercises, variables: { limit: 50 } });
      // shape may be { items, nextToken } or just array depending on your schema impl
      const items = data?.listExercises?.items ?? data?.listExercises ?? [];
      setExercises(items);
    })();
  }, []);

  const toggle = (ex) => {
    setPicked((cur) => cur.some(i => i.exercise_id === ex.exercise_id)
      ? cur.filter(i => i.exercise_id !== ex.exercise_id)
      : [...cur, ex]);
  };

  const build = async () => {
    const workout_id = uuid();
    const now = new Date().toISOString();
    let trainer_id = trainerIdFromRoute || null;
    if (!trainer_id) {
      try {
        const current = await getCurrentUser();
        const user_id = current?.userId || current?.username;
        const { data } = await client.graphql({ query: LIST_TRAINERS_BY_USER, variables: { user_id } });
        trainer_id = data?.listTrainers?.items?.[0]?.trainer_id || null;
      } catch (err) {
        console.log('Resolve trainer_id failed in builder', err);
      }
    }

    await client.graphql({ query: createWorkout, variables: {
      input: { workout_id, customer_id, trainer_id: trainer_id || null, name: `Workout ${new Date().toLocaleDateString()}`, created_at: now, updated_at: now }
    }});

    let idx = 0;
    for (const ex of picked) {
      await client.graphql({ query: createWorkoutItem, variables: {
        input: {
          workout_id,
          workout_item_index: idx++,
          exercise_id: ex.exercise_id,
          muscle_focus: '', target_sets: 3, target_reps: 10, target_tot: 30,
          target_velocity: 0, target_weight: 0, created_at: now, updated_at: now
        }
      }});
    }
    navigation.navigate('WorkoutRunner', { workout_id, customer_id, items: picked });
  };

  return (
    <View style={{ flex:1, padding:16 }}>
      <Text style={{ fontSize:18, fontWeight:'600', marginBottom:8 }}>Pick exercises</Text>
      <FlatList
        data={exercises}
        keyExtractor={i=>i.exercise_id}
        renderItem={({item}) => (
          <TouchableOpacity
            style={{ padding:12, borderWidth:1, borderColor: picked.some(p=>p.exercise_id===item.exercise_id)?'#4caf50':'#ddd', borderRadius:8, marginBottom:8 }}
            onPress={()=>toggle(item)}
          >
            <Text style={{ fontWeight:'600' }}>{item.name}</Text>
            <Text style={{ color:'#666' }}>{item.category}</Text>
          </TouchableOpacity>
        )}
      />
      <Button title={`Create Workout (${picked.length})`} onPress={build} disabled={!picked.length}/>
    </View>
  );
}
