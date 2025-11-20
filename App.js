import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import '@react-native-community/netinfo';

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { Amplify } from 'aws-amplify';
import awsconfig from './src/aws-exports';

// Configure Amplify early (v6 shape) before any screen imports
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: awsconfig.aws_user_pools_id,
      userPoolClientId: awsconfig.aws_user_pools_web_client_id,
      identityPoolId: awsconfig.aws_cognito_identity_pool_id,
      region: awsconfig.aws_cognito_region,
      signUpVerificationMethod: 'code',
    },
  },
  API: awsconfig.API,
});
// Quick visibility to ensure we are using the expected pool/client
console.log('Auth config', {
  region: awsconfig.aws_cognito_region,
  userPoolId: awsconfig.aws_user_pools_id,
  userPoolClientId: awsconfig.aws_user_pools_web_client_id,
});

import AuthGate from './src/screens/AuthGate';
import ProfileSetup from './src/screens/ProfileSetup';
import WorkoutBuilder from './src/screens/WorkoutBuilder';
import WorkoutRunner from './src/screens/WorkoutRunner';
import HomeScreen from './src/screens/HomeScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerBackTitle: 'Back' }} initialRouteName="Auth">
        <Stack.Screen name="Auth" component={AuthGate} options={{ title: 'Sign In' }} />
        <Stack.Screen name="ProfileSetup" component={ProfileSetup} options={{ title: 'Complete Profile' }} />
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Dashboard' }} />
        <Stack.Screen name="WorkoutBuilder" component={WorkoutBuilder} options={{ title: 'Build Workout' }} />
        <Stack.Screen name="WorkoutRunner" component={WorkoutRunner} options={{ title: 'Run Workout' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
