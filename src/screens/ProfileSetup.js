import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, ScrollView } from 'react-native';
import { getCurrentUser, fetchUserAttributes } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/api';
import { v4 as uuidv4 } from 'uuid';

// Mutations used to persist profile details
const updateUserMutation = /* GraphQL */ `
mutation UpdateUser($input: UpdateUserInput!) {
  updateUser(input: $input) { user_id _version }
}`;

const updateCustomerMutation = /* GraphQL */ `
mutation UpdateCustomer($input: UpdateCustomerInput!) {
  updateCustomer(input: $input) { customer_id _version }
}`;

// For robustness, allow creating a User row if it doesn't exist yet
const createUserMutation = /* GraphQL */ `
mutation CreateUser($input: CreateUserInput!) {
  createUser(input: $input) { user_id _version }
}`;

const getUserQuery = /* GraphQL */ `
query GetUser($user_id: ID!) {
  getUser(user_id: $user_id) { user_id email _version first_name last_name gender city state age current_weight height_inches fitness_goal role }
}`;

// Fetch an existing customer row for this user (generic list + filter)
const LIST_CUSTOMERS_BY_USER = /* GraphQL */ `
  query ListCustomers($user_id: ID!) {
    listCustomers(filter: { user_id: { eq: $user_id } }, limit: 1) {
      items { customer_id user_id preferred_workout_location fitness_focus _version }
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

export default function ProfileSetup({ navigation, route }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const nextRoute = route?.params?.next || 'Home';
  const [userVersion, setUserVersion] = useState(null);
  const [customerVersion, setCustomerVersion] = useState(null);
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
    preferred_workout_location: '',
    fitness_focus: '',
    role: ''
  });

  const updateField = (key, value) => setForm({ ...form, [key]: value });

  // Prefill form with existing values from API
  useEffect(() => {
    (async () => {
      try {
        const current = await getCurrentUser();
        const user_id = current?.userId || current?.username;
        const { data } = await client.graphql({ query: getUserQuery, variables: { user_id } });
        const u = data?.getUser;
        if (u) {
          setUserVersion(u._version || null);
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
            role: u.role ?? ''
          }));
        }

        // Prefill customer-specific fields if a row exists
        try {
          const r = await client.graphql({ query: LIST_CUSTOMERS_BY_USER, variables: { user_id } });
          const c = r?.data?.listCustomers?.items?.[0];
          if (c) {
            setCustomerVersion(c._version || null);
            setForm((f) => ({
              ...f,
              preferred_workout_location: c.preferred_workout_location ?? '',
              fitness_focus: c.fitness_focus ?? ''
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
      let version = userVersion;
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
            },
          },
          authMode: 'userPool',
        });
        version = res?.data?.createUser?._version || version;
      } catch (e) {
        // If the item already exists or create fails idempotently, continue to update
        console.log('createUser ignored:', e?.errors?.[0]?.message || e?.message || String(e));
      }

      // If we still do not have a version (existing record), fetch it to satisfy versioned update
      if (!version) {
        try {
          const latest = await client.graphql({ query: getUserQuery, variables: { user_id }, authMode: 'userPool' });
          version = latest?.data?.getUser?._version || null;
        } catch {}
      }

      // Update User (idempotent; sets current values)
      await client.graphql({
        query: updateUserMutation,
        variables: {
          input: {
            user_id,
            _version: version || undefined,
            first_name: form.first_name || null,
            last_name: form.last_name || null,
            gender: form.gender || null,
            city: form.city || null,
            state: form.state || null,
            age: ageVal,
            current_weight: weightVal,
            height_inches: heightVal,
            fitness_goal: form.fitness_goal || null,
            role: form.role || null,
          }
        },
        authMode: 'userPool',
      });

      // If the user identifies as a customer, ensure a customer row exists
      if ((form.role || '').toLowerCase() === 'customer') {
        // Try to find an existing customer row
        const listRes = await client.graphql({
          query: LIST_CUSTOMERS_BY_USER,
          variables: { user_id },
          authMode: 'userPool'
        });
        const existing = listRes?.data?.listCustomers?.items?.[0];

        if (existing?.customer_id) {
          await client.graphql({
            query: updateCustomerMutation,
            variables: {
              input: {
                customer_id: existing.customer_id,
                _version: existing._version || customerVersion || undefined,
                preferred_workout_location: form.preferred_workout_location || null,
                fitness_focus: form.fitness_focus || null,
                user_id
              }
            },
            authMode: 'userPool'
          });
        } else {
          const newId = uuidv4();
          await client.graphql({
            query: CREATE_CUSTOMER,
            variables: {
              input: {
                customer_id: newId,
                user_id,
                preferred_workout_location: form.preferred_workout_location || null,
                fitness_focus: form.fitness_focus || null,
              }
            },
            authMode: 'userPool'
          });
        }
      }

      console.log('Profile updated!');
      // Go to the intended next screen
      try {
        navigation.reset({ index: 0, routes: [{ name: nextRoute }] });
      } catch {
        navigation.replace(nextRoute);
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

      {(() => {
        const base = Object.keys(form).filter(k => k !== 'role');
        const visible = (form.role || '').toLowerCase() === 'customer'
          ? base.filter(k => k !== 'fitness_focus')
          : base;
        return visible.map((key) => (
          <TextInput
            key={key}
            style={styles.input}
            placeholder={key.replace(/_/g, ' ')}
            value={form[key]}
            onChangeText={(v) => updateField(key, v)}
          />
        ));
      })()}

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
});
