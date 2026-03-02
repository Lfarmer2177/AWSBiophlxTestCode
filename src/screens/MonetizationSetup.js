import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Button, Alert, ActivityIndicator, Linking, AppState } from 'react-native';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser } from 'aws-amplify/auth';
import * as WebBrowser from 'expo-web-browser';

// Mutation to trigger the client's biophlx-stripe-handler
const SETUP_STRIPE_ONBOARDING = /* GraphQL */ `
  mutation SetupStripeOnboarding($trainer_id: ID!, $email: String!) {
    setupStripeOnboarding(trainer_id: $trainer_id, email: $email) {
      onboarding_url
      stripe_account_id
      error
    }
  }
`;

const GET_TRAINER_BY_USER = /* GraphQL */ `
  query ListTrainers($user_id: ID!) {
    listTrainers(filter: { user_id: { eq: $user_id } }, limit: 1) {
      items { 
        trainer_id 
        user_id
        stripe_account_id 
        stripe_payouts_enabled 
        stripe_onboarded 
      }
    }
  }
`;

const LIST_TRAINERS_SCAN = /* GraphQL */ `
  query ListTrainersScan($limit: Int) {
    listTrainers(limit: $limit) {
      items {
        trainer_id
        user_id
        stripe_account_id
        stripe_payouts_enabled
        stripe_onboarded
      }
    }
  }
`;

export default function MonetizationSetup({ navigation }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [trainer, setTrainer] = useState(null);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    fetchTrainerStatus();

    // Listen for app returning to foreground
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        console.log('App has come to the foreground! Refreshing Stripe status...');
        fetchTrainerStatus(true); // silent refresh
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const fetchTrainerStatus = async (silent = false) => {
    // If called from a UI event, silent might be an object. Coerce to bool.
    const isSilent = silent === true;
    if (!isSilent) setRefreshing(true);
    try {
      const user = await getCurrentUser();
      const userId = user.userId;
      const username = user.username;
      
      console.log('MonetizationSetup: fetching trainer for userId:', userId, 'username:', username);
      
      let trainerData = null;

      // Try searching by userId first
      if (userId) {
        let res = await client.graphql({
          query: GET_TRAINER_BY_USER,
          variables: { user_id: userId }
        });
        let items = res?.data?.listTrainers?.items || [];
        trainerData = items.find(item => item.user_id === userId);
      }

      // If not found, try searching by username
      if (!trainerData && username && username !== userId) {
        console.log('MonetizationSetup: Not found by userId, trying username:', username);
        let res = await client.graphql({
          query: GET_TRAINER_BY_USER,
          variables: { user_id: username }
        });
        let items = res?.data?.listTrainers?.items || [];
        trainerData = items.find(item => item.user_id === username);
      }
      
      // Fallback: If still not found, try a shallow scan and check both
      if (!trainerData) {
        console.log('MonetizationSetup: Primary lookups failed, trying fallback scan...');
        const scanRes = await client.graphql({
          query: LIST_TRAINERS_SCAN,
          variables: { limit: 100 }
        });
        const scanItems = scanRes?.data?.listTrainers?.items || [];
        trainerData = scanItems.find(item => item.user_id === userId || item.user_id === username) || null;
      }
      
      console.log('MonetizationSetup: trainer data result:', trainerData);
      setTrainer(trainerData);
      
      if (!trainerData) {
        console.warn('MonetizationSetup: No trainer record found for user:', { userId, username });
      } else {
        console.log('MonetizationSetup: Successfully found trainer_id:', trainerData.trainer_id);
      }
      
      if (trainerData?.stripe_onboarded && !isSilent) {
        Alert.alert('Success', 'Your payments are now fully active!');
      }
    } catch (err) { 
      console.error('Failed to fetch trainer:', err);
    } finally {
      if (!isSilent) setRefreshing(false);
    }
  };

  const handleEnablePayouts = async () => {
    setLoading(true);
    try {
      const user = await getCurrentUser();
      
      if (!trainer) {
        Alert.alert('Error', 'Trainer profile not found.');
        return;
      }

      const response = await client.graphql({
        query: SETUP_STRIPE_ONBOARDING,
        variables: {
          trainer_id: trainer.trainer_id,
          email: user.signInDetails?.loginId || user.username
        }
      });

      console.log('Stripe Onboarding Response:', response);

      const setupData = response.data?.setupStripeOnboarding;
      
      if (!setupData) {
        throw new Error('No response from setupStripeOnboarding.');
      }

      if (setupData.error === 'ALREADY_ONBOARDED') {
        Alert.alert('Success', 'Your Stripe account is already fully onboarded!');
        fetchTrainerStatus();
        return;
      }

      const { onboarding_url, error } = setupData;
      
      if (error) throw new Error(error);

      if (onboarding_url) {
        // Use expo-web-browser to open the Stripe onboarding in-app
        await WebBrowser.openBrowserAsync(onboarding_url);
        Alert.alert(
          'Onboarding Started',
          'Once you finish in the browser, click "OK" to update your status.',
          [{ text: 'OK', onPress: () => fetchTrainerStatus() }]
        );
      }
    } catch (err) {
      console.error('Stripe setup failed:', err);
      Alert.alert('Error', err.message || 'Failed to setup payouts.');
    } finally {
      setLoading(false);
    }
  };

  const goHome = () => {
    try {
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    } catch {
      navigation.navigate('Home');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Get paid through Biophlx</Text>
      
      {/* {trainer?.stripe_onboarded ? (
        <View style={styles.successContainer}>
          <Text style={styles.successText}>✅ Your payments are active!</Text>
          <Text style={styles.body}>You are ready to sell workouts and services.</Text>
        </View>
      ) : ( */}
        <>
          <Text style={styles.body}>
            Biophlx uses Stripe to securely handle payments and payouts.{'\n'}
            Funds are deposited directly to your bank.
          </Text>
          
          {(loading || refreshing) ? (
            <ActivityIndicator size="large" color="#0000ff" />
          ) : (
            <View style={styles.buttonGroup}>
              <Button
                title="Enable Payouts"
                onPress={handleEnablePayouts}
              />
              {/* 
              {trainer?.stripe_account_id && (
                <View style={{ marginTop: 12 }}>
                  <Button title="Refresh Status" onPress={fetchTrainerStatus} color="#666" />
                </View>
              )}
              */}
            </View>
          )}
        </>
     {/* )} */}
      
      <View style={{ height: 24 }} />
      <Button title="Back to Home" onPress={goHome} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
  },
  body: {
    fontSize: 16,
    color: '#444',
    lineHeight: 22,
    marginBottom: 16,
  },
  successContainer: {
    padding: 20,
    backgroundColor: '#f0fff0',
    borderRadius: 8,
    marginBottom: 20,
    alignItems: 'center',
  },
  successText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2e7d32',
    marginBottom: 8,
  },
  buttonGroup: {
    marginTop: 10,
  }
});
