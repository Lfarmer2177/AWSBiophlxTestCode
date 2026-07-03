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
  Storage: {
    S3: {
      bucket: 'biophlx-profile-pictures',
      region: 'us-east-2',
    }
  }
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
import ExerciseLibrary from './src/screens/ExerciseLibrary';
import CreateWorkout from './src/screens/CreateWorkout';
import WorkoutLibrary from './src/screens/WorkoutLibrary';
import SessionsDashboard from './src/screens/SessionsDashboard';
import TrainerDashboard from './src/screens/TrainerDashboard';
import WorkoutProductBuilder from './src/screens/WorkoutProductBuilder';
import TrainerDirectory from './src/screens/TrainerDirectory';
import TrainerProfile from './src/screens/TrainerProfile';
import MonetizationSetup from './src/screens/MonetizationSetup';
import VirtualTrainingServiceBuilder from './src/screens/VirtualTrainingServiceBuilder';
import ClientListScreen from './src/screens/ClientListScreen';

import { BleProvider } from './src/context/BleContext';

import { GestureHandlerRootView } from 'react-native-gesture-handler';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BleProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerBackTitle: 'Back' }} initialRouteName="Auth">
            <Stack.Screen name="Auth" component={AuthGate} options={{ title: 'Sign In' }} />
            <Stack.Screen name="ProfileSetup" component={ProfileSetup} options={{ title: 'Complete Profile' }} />
            <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Dashboard' }} />
            <Stack.Screen name="WorkoutBuilder" component={WorkoutBuilder} options={{ title: 'Build Workout' }} />
            <Stack.Screen name="CreateWorkout" component={CreateWorkout} options={{ title: 'Create Workout' }} />
            <Stack.Screen name="WorkoutLibrary" component={WorkoutLibrary} options={{ title: 'My Workouts' }} />
            <Stack.Screen name="SessionDashboard" component={SessionsDashboard} options={{ title: 'Sessions' }} />
            <Stack.Screen name="WorkoutRunner" component={WorkoutRunner} options={{ title: 'Run Workout' }} />
            <Stack.Screen name="ExerciseLibrary" component={ExerciseLibrary} options={{ title: 'Exercise Library' }} />
            <Stack.Screen name="TrainerDashboard" component={TrainerDashboard} options={{ title: 'Trainer Dashboard' }} />
            <Stack.Screen name="WorkoutProductBuilder" component={WorkoutProductBuilder} options={{ title: 'Build Workout Product' }} />
            <Stack.Screen name="TrainerDirectory" component={TrainerDirectory} options={{ title: 'Trainers' }} />
            <Stack.Screen name="TrainerProfile" component={TrainerProfile} options={{ title: 'Trainer Profile' }} />
            <Stack.Screen name="MonetizationSetup" component={MonetizationSetup} options={{ title: 'Monetization Setup' }} />
            <Stack.Screen name='ClientListScreen' component={ClientListScreen} options={{ title: 'Client List' }} />
            <Stack.Screen
              name="VirtualTrainingServiceBuilder"
              component={VirtualTrainingServiceBuilder}
              options={{ title: 'Virtual Training Service' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </BleProvider>
    </GestureHandlerRootView>
  );
}
