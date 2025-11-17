import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Button, Alert } from 'react-native';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser, signOut } from 'aws-amplify/auth';
import { v4 as uuidv4 } from 'uuid';

const LIST_CUSTOMERS_BY_USER = /* GraphQL */ `
  query ListCustomers($user_id: ID!) {
    listCustomers(filter: { user_id: { eq: $user_id } }, limit: 1) {
      items { customer_id }
      nextToken
    }
  }
`;

const CREATE_CUSTOMER = /* GraphQL */ `
  mutation CreateCustomer($input: CreateCustomerInput!) {
    createCustomer(input: $input) { customer_id }
  }
`;

export default function HomeScreen({ navigation }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);

  const resolveCustomerId = async () => {
    try {
      const current = await getCurrentUser();
      const user_id = current?.userId || current?.username;
      const { data } = await client.graphql({ query: LIST_CUSTOMERS_BY_USER, variables: { user_id } });
      const existing = data?.listCustomers?.items?.[0]?.customer_id || null;
      if (existing) return existing;
      // Fallback: create a customer row on-the-fly
      const newId = uuidv4();
      const res = await client.graphql({
        query: CREATE_CUSTOMER,
        variables: { input: { customer_id: newId, user_id, preferred_workout_location: null, fitness_focus: null } }
      });
      return res?.data?.createCustomer?.customer_id || newId;
    } catch (e) {
      console.log('Resolve customer_id failed:', e);
      return null;
    }
  };

  const toBuilder = async () => {
    const customer_id = await resolveCustomerId();
    if (!customer_id) return;
    navigation.navigate('WorkoutBuilder', { customer_id });
  };

  const toRunner = async () => {
    const customer_id = await resolveCustomerId();
    if (!customer_id) return;
    navigation.navigate('WorkoutRunner', { customer_id });
  };

  const backToAuth = async () => {
    try {
      await signOut();
      navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
    } catch (e) {
      Alert.alert('Sign out failed', e?.message || 'Please try again.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Biophlx</Text>

      <View style={styles.card}><Text style={styles.label}>Choose where to go</Text></View>

      <Button title="Build a Workout" onPress={toBuilder} />
      <Button title="Run a Workout" onPress={toRunner} />
      <Button title="Edit Profile" onPress={() => navigation.navigate('ProfileSetup', { next: 'Home' })} />
      <Button title="Back to Login" onPress={backToAuth} />

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20
  },
  card: {
    width: '100%',
    padding: 15,
    marginBottom: 25,
    backgroundColor: '#eee',
    borderRadius: 10
  },
  label: {
    fontWeight: 'bold',
    fontSize: 16
  },
  value: {
    fontSize: 18,
    marginTop: 5
  }
});
