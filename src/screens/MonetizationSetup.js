import React from 'react';
import { View, Text, StyleSheet, Button } from 'react-native';

export default function MonetizationSetup({ navigation }) {
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
      <Text style={styles.body}>
        Biophlx uses Stripe to securely handle payments and payouts.{'\n'}
        You will keep 95% of every session.{'\n'}
        Funds are deposited directly to your bank.
      </Text>
      <View style={styles.bullets}>
        <Text style={styles.bullet}>- PCI compliant</Text>
        <Text style={styles.bullet}>- Weekly payouts</Text>
        <Text style={styles.bullet}>- Tax forms handled automatically</Text>
      </View>
      <Button
        title="Enable Payouts"
        onPress={() => {
          // Replace this placeholder with your Stripe AccountLink flow, then send the user home on success
          goHome();
        }}
      />
      <View style={{ height: 12 }} />
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
  bullets: {
    gap: 8,
    marginBottom: 24,
  },
  bullet: {
    fontSize: 16,
    color: '#222',
  },
});
