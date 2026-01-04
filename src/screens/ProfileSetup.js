import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, ScrollView } from 'react-native';
import { getCurrentUser, fetchUserAttributes } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/api';
import { v4 as uuidv4 } from 'uuid';

// Mutations used to persist profile details
const updateUserMutation = /* GraphQL */ `
mutation UpdateUser($input: UpdateUserInput!) {
  updateUser(input: $input) { user_id }
}`;

const updateCustomerMutation = /* GraphQL */ `
mutation UpdateCustomer($input: UpdateCustomerInput!) {
  updateCustomer(input: $input) { customer_id}
}`;

// For robustness, allow creating a User row if it doesn't exist yet
const createUserMutation = /* GraphQL */ `
mutation CreateUser($input: CreateUserInput!) {
  createUser(input: $input) { user_id }
}`;

const getUserQuery = /* GraphQL */ `
query GetUser($user_id: ID!) {
  getUser(user_id: $user_id) { user_id email first_name last_name gender city state age current_weight height_inches fitness_goal role bio workout_location }
}`;

// Fetch an existing customer row for this user (generic list + filter)
const LIST_CUSTOMERS_BY_USER = /* GraphQL */ `
  query ListCustomers($user_id: ID!) {
    listCustomers(filter: { user_id: { eq: $user_id } }, limit: 1) {
      items { customer_id user_id preferred_workout_location fitness_focus }
      nextToken
    }
  }
`;

// Create a new customer row
const CREATE_CUSTOMER = /* GraphQL */ `
  mutation CreateCustomer($input: CreateCustomerInput!) {
    createCustomer(input: $input) { customer_id }
  }
`;

// Trainer helpers
const LIST_TRAINERS_BY_USER = /* GraphQL */ `
  query ListTrainers($user_id: ID!) {
    listTrainers(filter: { user_id: { eq: $user_id } }, limit: 1) {
      items { trainer_id user_id }
      nextToken
    }
  }
`;

const CREATE_TRAINER = /* GraphQL */ `
  mutation CreateTrainer($input: CreateTrainerInput!) {
    createTrainer(input: $input) { trainer_id }
  }
`;

export default function ProfileSetup({ navigation, route }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const nextRoute = route?.params?.next || 'Home';
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    gender: '',
    city: '',
    state: '',
    age: '',
    current_weight: '',
    height_inches: '',
    fitness_goal: '',
    workout_location: '',
    bio: '',
    fitness_focus: [],
    role: ''
  });
  const [customerId, setCustomerId] = useState(null);

  const updateField = (key, value) => setForm({ ...form, [key]: value });

  // Helper to safely normalize string/array fields from API
  const toArray = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val.map((v) => (v ?? '').toString()).filter(Boolean);
    if (typeof val === 'string') {
      return val
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return [];
  };

  // Prefill form with existing values from API
  useEffect(() => {
    (async () => {
      try {
        const current = await getCurrentUser();
        const user_id = current?.userId || current?.username;
        const { data } = await client.graphql({ query: getUserQuery, variables: { user_id } });
        const u = data?.getUser;
        if (u) {
          setForm((f) => ({
            ...f,
            first_name: u.first_name ?? '',
            last_name: u.last_name ?? '',
            gender: u.gender ?? '',
            city: u.city ?? '',
            state: u.state ?? '',
            age: u.age != null ? String(u.age) : '',
            current_weight: u.current_weight != null ? String(u.current_weight) : '',
            height_inches: u.height_inches != null ? String(u.height_inches) : '',
            fitness_goal: u.fitness_goal ?? '',
            workout_location: u.workout_location ?? '',
            bio: u.bio ?? '',
            role: u.role ?? '',
            fitness_focus: toArray(u.fitness_focus).map((v) => v.toLowerCase()),
          }));
        }

        // Prefill customer-specific fields if a row exists
        try {
          const r = await client.graphql({ query: LIST_CUSTOMERS_BY_USER, variables: { user_id } });
          const c = r?.data?.listCustomers?.items?.[0];
          if (c) {
            setCustomerId(c.customer_id);
            setForm((f) => ({
              ...f,
              fitness_focus: toArray(c.fitness_focus).map((v) => v.toLowerCase())
            }));
          }
        } catch {}
      } catch {}
    })();
  }, [client]);

  const handleSave = async () => {
    try {
      const current = await getCurrentUser();
      const user_id = current?.userId || current?.username;

      console.log('Updating profile for:', user_id);

      const ageVal = form.age?.toString().trim() ? parseInt(form.age, 10) : null;
      const weightVal = form.current_weight?.toString().trim() ? parseFloat(form.current_weight) : null;
      const heightVal = form.height_inches?.toString().trim() ? parseFloat(form.height_inches) : null;

      // Create-first strategy (avoids getUser dependency while resolvers are finalized)
      const attrs = await fetchUserAttributes().catch(() => ({}));
      const email = attrs?.email || '';
      console.log('Profile save payload', {
        user_id,
        first_name: form.first_name || null,
        last_name: form.last_name || null,
        gender: form.gender || null,
        city: form.city || null,
        state: form.state || null,
        age: form.age || null,
        current_weight: form.current_weight || null,
        height_inches: form.height_inches || null,
        fitness_goal: form.fitness_goal || null,
        workout_location: form.workout_location || null,
        bio: form.bio || null,
        role: form.role || null,
        email,
      });

      // Try to create; ignore conflicts
      try {
        const res = await client.graphql({
          query: createUserMutation,
          variables: {
            input: {
              user_id,
              email,
              first_name: form.first_name || null,
              last_name: form.last_name || null,
              gender: form.gender || null,
              city: form.city || null,
              state: form.state || null,
              age: ageVal,
              current_weight: weightVal,
              height_inches: heightVal,
              fitness_goal: form.fitness_goal || null,
              workout_location: form.workout_location || null,
              bio: form.bio || null,
            },
          },
          authMode: 'userPool',
        });
      } catch (e) {
        console.log('createUser ignored:', e?.errors?.[0]?.message || e?.message || String(e));
      }

      // Update User (idempotent; sets current values)
      await client.graphql({
        query: updateUserMutation,
        variables: {
          input: {
            user_id,
            first_name: form.first_name || null,
            last_name: form.last_name || null,
            gender: form.gender || null,
            city: form.city || null,
            state: form.state || null,
            age: ageVal,
            current_weight: weightVal,
            height_inches: heightVal,
            fitness_goal: form.fitness_goal || null,
            workout_location: form.workout_location || null,
            bio: form.bio || null,
            role: form.role || null,
          },
        },
        authMode: 'userPool',
      });
      console.log('Update user payload sent to API', {
        user_id,
        first_name: form.first_name || null,
        last_name: form.last_name || null,
        gender: form.gender || null,
        city: form.city || null,
        state: form.state || null,
        age: form.age || null,
        current_weight: form.current_weight || null,
        height_inches: form.height_inches || null,
        fitness_goal: form.fitness_goal || null,
        workout_location: form.workout_location || null,
        bio: form.bio || null,
        role: form.role || null,
      });

      // If the user identifies as a customer, ensure a customer row exists
      if ((form.role || '').toLowerCase() === 'customer') {
        const custId = user_id; // Always use user_id to avoid duplicate customer rows
        try {
          await client.graphql({
            query: updateCustomerMutation,
            variables: {
              input: {
                customer_id: custId,
                fitness_focus: form.fitness_focus?.length ? form.fitness_focus.join(',') : null,
                user_id,
              },
            },
            authMode: 'userPool',
          });
          setCustomerId(custId);
        } catch (errUpdate) {
          console.log('updateCustomer failed, attempting create', errUpdate?.errors?.[0]?.message || errUpdate?.message || String(errUpdate));
          try {
            await client.graphql({
              query: CREATE_CUSTOMER,
              variables: {
                input: {
                  customer_id: custId,
                  user_id,
                  fitness_focus: form.fitness_focus?.length ? form.fitness_focus.join(',') : null,
                },
              },
              authMode: 'userPool',
            });
            setCustomerId(custId);
          } catch (errCreate) {
            console.log('createCustomer failed', errCreate?.errors?.[0]?.message || errCreate?.message || String(errCreate));
          }
        }
      }

      // If the user identifies as a trainer, ensure a trainer row exists
      if ((form.role || '').toLowerCase() === 'trainer') {
        const now = new Date().toISOString();
        console.log('Create trainer payload', {
          trainer_id: 'uuid-will-be-generated',
          user_id,
          training_focus: form.fitness_focus || null,
          total_clients: 0,
          total_revenue: 0,
          workouts_sold: 0,
          services_sold: 0,
          created_at: now,
          updated_at: now,
        });
        try {
          const trainerRes = await client.graphql({
            query: LIST_TRAINERS_BY_USER,
            variables: { user_id },
            authMode: 'userPool',
          });
          const existingTrainer = trainerRes?.data?.listTrainers?.items?.[0];
          if (!existingTrainer) {
            const newTrainerId = uuidv4();
            await client.graphql({
              query: CREATE_TRAINER,
              variables: {
                input: {
                  trainer_id: newTrainerId,
                  user_id,
                  training_focus: form.fitness_focus || null,
                  total_clients: 0,
                  total_revenue: 0,
                  workouts_sold: 0,
                  services_sold: 0,
                  created_at: now,
                  updated_at: now,
                },
              },
              authMode: 'userPool',
            });
          }
        } catch (err) {
          console.log('Create trainer failed', err?.errors?.[0]?.message || err?.message || String(err));
        }
      }

      console.log('Profile updated!');
      // Go to the intended next screen
      const isTrainer = (form.role || '').toLowerCase() === 'trainer';
      const targetRoute = isTrainer ? 'MonetizationSetup' : nextRoute;
      try {
        navigation.reset({ index: 0, routes: [{ name: targetRoute }] });
      } catch {
        navigation.replace(targetRoute);
      }
    } catch (err) {
      console.log('Error saving profile:', err, JSON.stringify(err, null, 2));
    }
  };

  const handleSkip = () => {
    try {
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    } catch {
      navigation.replace('Home');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>Complete Your Profile</Text>

      <View style={{ flexDirection: 'row', columnGap: 10, marginBottom: 12 }}>
        <Button
          title={`I am a Customer${form.role === 'customer' ? ' ✓' : ''}`}
          onPress={() => setForm({ ...form, role: 'customer' })}
        />
        <Button
          title={`I am a Trainer${form.role === 'trainer' ? ' ✓' : ''}`}
          onPress={() => setForm({ ...form, role: 'trainer' })}
        />
      </View>

      <TextInput
        style={styles.input}
        placeholder="first name"
        value={form.first_name}
        onChangeText={(v) => updateField('first_name', v)}
      />
      <TextInput
        style={styles.input}
        placeholder="last name"
        value={form.last_name}
        onChangeText={(v) => updateField('last_name', v)}
      />

      <View style={{ width: '95%', marginVertical: 8 }}>
        <Text style={styles.label}>Gender</Text>
        <View style={{ flexDirection: 'row', columnGap: 10, marginTop: 6 }}>
          {['male', 'female'].map((g) => (
            <Button
              key={g}
              title={`${g === 'male' ? 'Male' : 'Female'}${form.gender === g ? ' ✓' : ''}`}
              onPress={() => updateField('gender', g)}
            />
          ))}
        </View>
      </View>

      <TextInput
        style={styles.input}
        placeholder="city"
        value={form.city}
        onChangeText={(v) => updateField('city', v)}
      />
      <TextInput
        style={styles.input}
        placeholder="state"
        value={form.state}
        onChangeText={(v) => updateField('state', v)}
      />
      <TextInput
        style={styles.input}
        placeholder="age"
        keyboardType="number-pad"
        value={form.age}
        onChangeText={(v) => updateField('age', v)}
      />
      <TextInput
        style={styles.input}
        placeholder="current weight"
        keyboardType="decimal-pad"
        value={form.current_weight}
        onChangeText={(v) => updateField('current_weight', v)}
      />
      <TextInput
        style={styles.input}
        placeholder="height inches"
        keyboardType="decimal-pad"
        value={form.height_inches}
        onChangeText={(v) => updateField('height_inches', v)}
      />
      <TextInput
        style={styles.input}
        placeholder="fitness goal"
        value={form.fitness_goal}
        onChangeText={(v) => updateField('fitness_goal', v)}
      />

      <View style={{ width: '95%', marginVertical: 8 }}>
        <Text style={styles.label}>Workout Location</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
          {['commercial gym', 'home gym', 'studio'].map((opt) => (
            <Button
              key={opt}
              title={`${opt}${form.workout_location === opt ? ' ✓' : ''}`}
              onPress={() => updateField('workout_location', opt)}
            />
          ))}
        </View>
      </View>

      <TextInput
        style={styles.input}
        placeholder="bio"
        value={form.bio}
        onChangeText={(v) => updateField('bio', v)}
      />

      <View style={{ width: '95%', marginVertical: 8 }}>
        <Text style={styles.label}>Fitness Focus (choose one or more)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
          {['lose fat', 'gain muscle', 'muscular endurance', 'targeted muscle focus'].map((opt) => {
            const normalized = opt.toLowerCase();
            const selected = form.fitness_focus.includes(normalized);
            return (
              <Button
                key={opt}
                title={`${opt}${selected ? ' ✓' : ''}`}
                onPress={() => {
                  const next = selected
                    ? form.fitness_focus.filter((v) => v !== normalized)
                    : [...form.fitness_focus, normalized];
                  updateField('fitness_focus', next);
                }}
              />
            );
          })}
        </View>
      </View>

      <Button title="Save & Continue" onPress={handleSave} />
      <View style={{ height: 12 }} />
      <Button title="Skip for now" onPress={handleSkip} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  input: {
    width: '95%',
    padding: 12,
    borderWidth: 1,
    marginVertical: 8,
    borderRadius: 8,
  },
  label: {
    fontWeight: '700',
    color: '#0f172a',
  },
});
