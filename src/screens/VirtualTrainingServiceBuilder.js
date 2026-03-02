import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser } from 'aws-amplify/auth';

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

const LIST_WORKOUT_PRODUCTS_BY_TRAINER = /* GraphQL */ `
  query ListWorkoutProductsByTrainer($trainer_id: ID!, $limit: Int) {
    listWorkoutProductsByTrainer(trainer_id: $trainer_id, limit: $limit) {
      workout_product_id
      name
    }
  }
`;

const CREATE_VIRTUAL_SERVICE = /* GraphQL */ `
  mutation CreateVirtualTrainingService($input: CreateVirtualTrainingServiceInput!) {
    createVirtualTrainingService(input: $input) { 
      service_id 
      stripe_product_id
      stripe_price_id
    }
  }
`;

const CREATE_STRIPE_PRODUCT = /* GraphQL */ `
  mutation createStripeProduct(
    $trainer_id: ID!,
    $name: String!,
    $price: Float!,
    $description: String,
    $product_type: String,
    $workout_ids: [ID],
    $workout_products: [ID],
    $duration_weeks: Int
  ) {
    createStripeProduct(
      trainer_id: $trainer_id,
      name: $name,
      price: $price,
      description: $description,
      product_type: $product_type,
      workout_ids: $workout_ids,
      workout_products: $workout_products,
      duration_weeks: $duration_weeks
    ) {
      service_id
      stripe_product_id
      stripe_price_id
      error
    }
  }
`;

export default function VirtualTrainingServiceBuilder({ route, navigation }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const trainer_id = route?.params?.trainer_id;

  const [serviceName, setServiceName] = useState('');
  const [description, setDescription] = useState('');
  const [durationWeeks, setDurationWeeks] = useState('');
  const [price, setPrice] = useState('');
  const [workouts, setWorkouts] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedWorkouts, setSelectedWorkouts] = useState([]);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const toggleSelection = (id, list, setter) => {
    if (!id) return;
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const loadData = useCallback(async () => {
    if (!trainer_id) return;
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch workouts by trainer_id
      const workoutRes = await client.graphql({
        query: LIST_WORKOUTS_BY_TRAINER,
        variables: { trainer_id, limit: 100 },
      }).catch(() => ({ data: {} }));
      
      // 2. Fetch workouts by customer_id (current user)
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
           console.log('Resolved customer ID for service builder:', resolvedCustomerId);
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

      const trainerWorkouts = workoutRes?.data?.listWorkoutsByTrainer?.items || workoutRes?.data?.listWorkoutsByTrainer || [];
      const customerWorkouts = customerRes?.data?.listWorkoutsByCustomer?.items || customerRes?.data?.listWorkoutsByCustomer || [];
      
      // Merge and dedup workouts
      const allWorkouts = [...trainerWorkouts, ...customerWorkouts];
      const uniqueWorkouts = [];
      const seenW = new Set();
      for (const w of allWorkouts) {
        if (w?.workout_id && !seenW.has(w.workout_id)) {
          seenW.add(w.workout_id);
          uniqueWorkouts.push(w);
        }
      }
      // Sort by creation date
      uniqueWorkouts.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

      setWorkouts(
        uniqueWorkouts
          .filter((w) => w?.workout_id)
          .map((w) => ({ id: w.workout_id, name: w.name || w.workout_id }))
      );

      const productRes = await client.graphql({
        query: LIST_WORKOUT_PRODUCTS_BY_TRAINER,
        variables: { trainer_id, limit: 100 },
      });
      const productsRaw = productRes?.data?.listWorkoutProductsByTrainer;
      const productItems = Array.isArray(productsRaw?.items) ? productsRaw.items : Array.isArray(productsRaw) ? productsRaw : [];
      setProducts(
        productItems
          .filter((p) => p?.workout_product_id)
          .map((p) => ({ id: p.workout_product_id, name: p.name || p.workout_product_id }))
      );
    } catch (e) {
      setError(e?.message || 'Failed to load workouts/products.');
    } finally {
      setLoading(false);
    }
  }, [client, trainer_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    if (!trainer_id) {
      Alert.alert('Missing trainer', 'Trainer ID is required.');
      return;
    }
    if (!serviceName.trim()) {
      Alert.alert('Missing name', 'Please enter a service name.');
      return;
    }
    
    const priceNum = price ? parseFloat(price) : 0;
    if (priceNum <= 0) {
      Alert.alert('Invalid Price', 'Please enter a valid price greater than 0.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // 1. Backend handles both Stripe Sync AND DynamoDB record creation
      console.log('Syncing service to Stripe and DB with variables:', {
        trainer_id: trainer_id,
        name: serviceName.trim(),
        price: priceNum,
        product_type: 'service'
      });

      const stripeRes = await client.graphql({
        query: CREATE_STRIPE_PRODUCT,
        variables: {
          trainer_id: trainer_id,
          name: serviceName.trim(),
          price: priceNum,
          description: description.trim() || `Virtual Training Service: ${serviceName}`,
          product_type: 'service',
          workout_ids: selectedWorkouts,
          workout_products: selectedProducts,
          duration_weeks: durationWeeks ? parseInt(durationWeeks, 10) : null
        }
      });

      console.log('Full Service Sync Response:', JSON.stringify(stripeRes, null, 2));

      const stripeData = stripeRes.data?.createStripeProduct;
      
      if (!stripeData) {
        throw new Error('No data returned from createStripeProduct mutation.');
      }

      if (stripeData.error) {
        throw new Error(`Sync Error: ${stripeData.error}`);
      }

      if (!stripeData.stripe_product_id) {
        throw new Error(`Incomplete sync: Service created but Stripe ID is missing. Data: ${JSON.stringify(stripeData)}`);
      }

      Alert.alert('Saved', 'Virtual training service created and synced successfully.');
      navigation.goBack();
    } catch (e) {
      setError(e?.errors?.[0]?.message || e?.message || 'Failed to save service.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Create Virtual Training Service</Text>
      {loading ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TextInput
        style={styles.input}
        placeholder="Service name"
        value={serviceName}
        onChangeText={setServiceName}
      />
      <TextInput
        style={[styles.input, { height: 100 }]}
        placeholder="Description"
        multiline
        value={description}
        onChangeText={setDescription}
      />
      <TextInput
        style={styles.input}
        placeholder="Duration (weeks)"
        keyboardType="numeric"
        value={durationWeeks}
        onChangeText={setDurationWeeks}
      />
      <TextInput
        style={styles.input}
        placeholder="Price (USD)"
        keyboardType="decimal-pad"
        value={price}
        onChangeText={setPrice}
      />

      <Text style={styles.section}>Include workouts</Text>
      {workouts.map((w) => {
        const selected = selectedWorkouts.includes(w.id);
        return (
          <TouchableOpacity
            key={w.id}
            style={[styles.row, selected && styles.selectedRow]}
            onPress={() => toggleSelection(w.id, selectedWorkouts, setSelectedWorkouts)}
          >
            <Text>{w.name}</Text>
          </TouchableOpacity>
        );
      })}
      {!workouts.length && !loading ? <Text style={styles.muted}>No workouts found.</Text> : null}

      <Text style={styles.section}>Include workout products</Text>
      {products.map((p) => {
        const selected = selectedProducts.includes(p.id);
        return (
          <TouchableOpacity
            key={p.id}
            style={[styles.row, selected && styles.selectedRow]}
            onPress={() => toggleSelection(p.id, selectedProducts, setSelectedProducts)}
          >
            <Text>{p.name}</Text>
          </TouchableOpacity>
        );
      })}
      {!products.length && !loading ? <Text style={styles.muted}>No workout products found.</Text> : null}

      <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
        <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save Service'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fff',
  },
  section: {
    marginTop: 8,
    fontWeight: '700',
  },
  row: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    backgroundColor: '#fff',
    marginTop: 6,
  },
  selectedRow: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  muted: {
    color: '#94a3b8',
  },
  error: {
    color: '#b91c1c',
  },
  saveButton: {
    marginTop: 16,
    backgroundColor: '#2563eb',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveText: {
    color: '#fff',
    fontWeight: '700',
  },
});
