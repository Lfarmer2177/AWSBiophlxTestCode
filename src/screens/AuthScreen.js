import React, { useEffect } from 'react';
import { View, StyleSheet, PermissionsAndroid, Platform } from 'react-native';
import { Authenticator } from '@aws-amplify/ui-react-native';

const AuthScreen = () => {
  useEffect(() => {
    const requestBlePermissions = async () => {
      if (Platform.OS === 'android') {
        try {
          await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          ]);
        } catch (err) {
          console.warn('BLE permission request failed', err);
        }
      }
    };

    requestBlePermissions();
  }, []);

  return (
    <View style={styles.container}>
      <Authenticator />
    </View>
  );
};

export default AuthScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
});
