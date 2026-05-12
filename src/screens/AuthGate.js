import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet } from 'react-native';
import {
  signUp,
  confirmSignUp,
  signIn,
  getCurrentUser,
  signOut,
  fetchAuthSession,
  resetPassword,
  confirmResetPassword,
} from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/api';

const createUserMutation = /* GraphQL */ `
mutation CreateUser($input: CreateUserInput!) {
  createUser(input: $input) {
    user_id
  }
}`;

const createCustomerMutation = /* GraphQL */ `
mutation CreateCustomer($input: CreateCustomerInput!) {
  createCustomer(input: $input) {
    customer_id
  }
}`;

export default function AuthGate({ navigation }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [screen, setScreen] = useState('signin');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [newUsername, setNewUsername] = useState(''); 
  const [error, setError] = useState('');
  const [booting, setBooting] = useState(true);
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await fetchAuthSession();
        if (!active) return;
        if (session?.tokens) {
          navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
          return;
        }
      } catch (err) {
        console.log('Session check failed:', err?.message || err);
      } finally {
        if (active) setBooting(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [navigation]);

  const handleSignUp = async () => {
    try {
      const response = await signUp({
        username: email,
        password,
        options: { userAttributes: { email } }
      });
      console.log("Sign up success:", response);
      setNewUsername(email);
      setScreen('confirm');
    } catch (err) {
      console.log("Sign up error:", err, JSON.stringify(err, null, 2));
      const message = err?.message || String(err);
      setError(message);
    }
  };

  const handleConfirm = async () => {
    try {
      await confirmSignUp({ username: newUsername, confirmationCode });
      console.log("Email confirmed!");
      setScreen('signin');
    } catch (error) {
      console.log("Confirm error:", error, JSON.stringify(error, null, 2));
      const message = error?.message || String(error);
      setError(message);
    }
  };

  const handleSignIn = async () => {
    try {
      const username = (email || '').trim();
      await signIn({ username, password, options: { authFlowType: 'USER_PASSWORD_AUTH' } });
      const current = await getCurrentUser();
      const user_id = current?.userId || current?.username || email;

      await client.graphql({ query: createUserMutation, variables: { input: { user_id, email } }, authMode: 'userPool' }).catch(() => console.log('User already exists'));

      await client.graphql({ query: createCustomerMutation, variables: { input: { customer_id: user_id, user_id } }, authMode: 'userPool' }).catch(() => console.log('Customer already exists'));

      navigation.replace("ProfileSetup", { next: 'Home' });

    } catch (err) {
      console.log("Sign in error:", err, JSON.stringify(err, null, 2));
      const message = err?.message || String(err);
      setError(message);
    }

  };

  const handleForgot = async () => {
    try {
      const username = (email || '').trim();
      if (!username) {
        setError('Enter your email to reset your password.');
        return;
      }
      await resetPassword({ username });
      setError('');
      setScreen('reset');
    } catch (err) {
      console.log('Forgot password error:', err);
      setError(err?.message || String(err));
    }
  };

  const handleReset = async () => {
    try {
      const username = (email || '').trim();
      await confirmResetPassword({ username, confirmationCode: resetCode, newPassword: resetPassword });
      setError('');
      setResetCode('');
      setResetPassword('');
      setScreen('signin');
    } catch (err) {
      console.log('Reset password error:', err);
      setError(err?.message || String(err));
    }
  };

  if (booting) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Biophlx Login</Text>
      {!!error && <Text style={{ color: 'crimson', marginBottom: 10 }}>{error}</Text>}

      {screen === 'signin' && (
        <>
          <TextInput style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none" />

          <TextInput style={styles.input}
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword} />

          <Button title="Sign In" onPress={handleSignIn} />
          <View style={{ marginTop: 20 }}>
            <Button title="Create Account" onPress={() => setScreen('signup')} />
          </View>
          <View style={{ marginTop: 10 }}>
            <Button title="Forgot Password" onPress={handleForgot} />
          </View>
          <View style={{ marginTop: 10 }}>
            <Button title="Sign Out" onPress={async () => { try { await signOut(); setError(''); } catch (e) { setError(e?.message || String(e)); } }} />
          </View>
        </>
      )}

      {screen === 'signup' && (
        <>
          <TextInput style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none" />

          <TextInput style={styles.input}
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword} />

          <Button title="Sign Up" onPress={handleSignUp} />
        </>
      )}

      {screen === 'confirm' && (
        <>
          <TextInput style={styles.input}
            placeholder="Confirmation Code"
            value={confirmationCode}
            onChangeText={setConfirmationCode} />

          <Button title="Confirm" onPress={handleConfirm} />
        </>
      )}

      {screen === 'reset' && (
        <>
          <TextInput
            style={styles.input}
            placeholder="Code"
            value={resetCode}
            onChangeText={setResetCode}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="New Password"
            secureTextEntry
            value={resetPassword}
            onChangeText={setResetPassword}
          />
          <Button title="Set New Password" onPress={handleReset} />
          <View style={{ marginTop: 10 }}>
            <Button title="Back to Sign In" onPress={() => setScreen('signin')} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff'
  },
  title: {
    fontSize: 28,
    marginBottom: 30,
    fontWeight: 'bold'
  },
  input: {
    width: '90%',
    padding: 12,
    marginVertical: 8,
    borderWidth: 1,
    borderRadius: 8
  }
});
