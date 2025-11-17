// CustomerProfileScreen.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator, Alert
} from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser } from 'aws-amplify/auth';

// If you're not already configuring Amplify at app root, do it here:
// import awsconfig from '../aws-exports';
// Amplify.configure(awsconfig);

// Avoid early initialization before Amplify.configure
let client;

/* ---------- GraphQL documents (adjust names if your schema differs) ---------- */

// 1) Find an existing customer row for this user (using a list + filter is generic)
const LIST_CUSTOMERS_BY_USER = /* GraphQL */ `
  query ListCustomers($user_id: ID!) {
    listCustomers(filter: { user_id: { eq: $user_id } }, limit: 1) {
      items { customer_id user_id preferred_workout_location fitness_focus created_at updated_at }
      nextToken
    }
  }
`;

// 2) Create
const CREATE_CUSTOMER = /* GraphQL */ `
  mutation CreateCustomer($input: CreateCustomerInput!) {
    createCustomer(input: $input) {
      customer_id user_id preferred_workout_location fitness_focus created_at updated_at
    }
  }
`;

// 3) Update
const UPDATE_CUSTOMER = /* GraphQL */ `
  mutation UpdateCustomer($input: UpdateCustomerInput!) {
    updateCustomer(input: $input) {
      customer_id user_id preferred_workout_location fitness_focus created_at updated_at
    }
  }
`;

export default function CustomerProfileScreen() {
  client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // editable fields
  const [preferredWorkoutLocation, setPreferredWorkoutLocation] = useState('');
  const [fitnessFocus, setFitnessFocus] = useState('');

  // derived / hidden fields
  const [userId, setUserId] = useState(null);
  const [customerId, setCustomerId] = useState(null); // null means "new"

  useEffect(() => {
    (async () => {
      try {
        // Get Cognito userId (sub)
        const user = await getCurrentUser(); // Amplify Auth v6
        const sub = user?.userId || user?.username; // depending on config
        setUserId(sub);

        // Try to load existing customer row
        const res = await client.graphql({
          query: LIST_CUSTOMERS_BY_USER,
          variables: { user_id: sub },
          authMode: 'userPool' // or 'apiKey' / 'iam' based on your API
        });

        const existing = res?.data?.listCustomers?.items?.[0];
        if (existing) {
          setCustomerId(existing.customer_id);
          setPreferredWorkoutLocation(existing.preferred_workout_location ?? '');
          setFitnessFocus(existing.fitness_focus ?? '');
        }
      } catch (e) {
        console.error('Load customer failed:', e);
        Alert.alert('Error', 'Could not load your customer profile.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function onSave() {
    if (!userId) {
      Alert.alert('Not signed in', 'Please sign in again.');
      return;
    }
    if (!preferredWorkoutLocation.trim() && !fitnessFocus.trim()) {
      Alert.alert('Add something', 'Please enter at least one field.');
      return;
    }

    setSaving(true);
    try {
      if (customerId) {
        // update
        const res = await client.graphql({
          query: UPDATE_CUSTOMER,
          variables: {
            input: {
              customer_id: customerId,
              // only send fields you want to change
              preferred_workout_location: preferredWorkoutLocation || null,
              fitness_focus: fitnessFocus || null,
            }
          },
          authMode: 'userPool'
        });
        const updated = res?.data?.updateCustomer;
        setPreferredWorkoutLocation(updated?.preferred_workout_location ?? '');
        setFitnessFocus(updated?.fitness_focus ?? '');
        Alert.alert('Saved', 'Your profile was updated.');
      } else {
        // create
        const newId = uuidv4();
        const res = await client.graphql({
          query: CREATE_CUSTOMER,
          variables: {
            input: {
              customer_id: newId,
              user_id: userId,
              preferred_workout_location: preferredWorkoutLocation || null,
              fitness_focus: fitnessFocus || null,
            }
          },
          authMode: 'userPool'
        });
        const created = res?.data?.createCustomer;
        setCustomerId(created.customer_id);
        Alert.alert('Created', 'Your profile was created.');
      }
    } catch (e) {
      console.error('Save failed:', e);
      Alert.alert('Error', 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading your profile…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Customer Profile</Text>

      <Text style={styles.label}>Preferred Workout Location</Text>
      <TextInput
        value={preferredWorkoutLocation}
        onChangeText={setPreferredWorkoutLocation}
        placeholder="Home, Gym, Outside…"
        style={styles.input}
        autoCapitalize="words"
      />

      <Text style={styles.label}>Fitness Focus</Text>
      <TextInput
        value={fitnessFocus}
        onChangeText={setFitnessFocus}
        placeholder="Strength, Mobility, Fat Loss…"
        style={styles.input}
        autoCapitalize="words"
      />

      <TouchableOpacity style={[styles.button, saving && { opacity: 0.7 }]} onPress={onSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{customerId ? 'Save Changes' : 'Create Profile'}</Text>}
      </TouchableOpacity>

      <View style={styles.meta}>
        <Text style={styles.metaText}>user_id: {userId || '—'}</Text>
        <Text style={styles.metaText}>customer_id: {customerId || '— (new will be created)'} </Text>
      </View>
    </View>
  );
}

/* ------------------------------- styling ------------------------------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0e13', padding: 16 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 16 },
  label: { color: '#cbd5e1', marginTop: 10, marginBottom: 6, fontWeight: '600' },
  input: {
    backgroundColor: '#0f172a',
    color: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  button: {
    marginTop: 18,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center'
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  meta: { marginTop: 18 },
  metaText: { color: '#64748b', fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0e13' },
  muted: { color: '#94a3b8', marginTop: 8 }
});
