import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState, PermissionsAndroid, Platform } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import base64 from 'react-native-base64';
import {
    BLE_CONSTANTS,
    BleUuids,
    DeviceCommands,
    ExerciseLimb,
    ExerciseSide,
    createCommand,
} from '../constants/bleConstants';

export const SERVICE_UUIDS = {
    deviceStatus: BleUuids.deviceStatusService,
    command: BleUuids.deviceCommandService,
};

export const CHARACTERISTICS = {
    rom: BleUuids.rangeOfMotion,
    tut: BleUuids.timeUnderTension,
    velocity: BleUuids.acceleration,
    currentPosition: BleUuids.currentPosition,
    command: BleUuids.command,
    reps: BleUuids.repsCompleted,
    sets: BleUuids.setComplete,
    exerciseStage: BleUuids.exerciseStage,
};

const initialFeedback = {
    ROM: 0,
    TUT: 0,
    Velocity: 0,
    Score: 0,
    'Current Position': 0,
    reps: 0,
    sets: 0,
    setc: 0,
    exerciseStage: 0,
};

const bleManager = new BleManager();
const BleContext = createContext(null);
const defaultDeviceSettings = {
    primary: {
        limb: ExerciseLimb.leg.value,
        side: ExerciseSide.right.value,
    },
    secondary: {
        limb: ExerciseLimb.arm.value,
        side: ExerciseSide.left.value,
    },
};

// Approximate travel radii used to convert angular velocity (deg/s) to linear speed (m/s).
const LIMB_RADIUS_METERS = {
    [ExerciseLimb.arm.value]: 0.55,
    [ExerciseLimb.leg.value]: 0.9,
    [ExerciseLimb.undefined.value]: 0.7,
};

const getVelocityRadiusMeters = (limb) => {
    if (LIMB_RADIUS_METERS[limb] !== undefined) return LIMB_RADIUS_METERS[limb];
    return LIMB_RADIUS_METERS[ExerciseLimb.undefined.value];
};

const convertDegreesPerSecondToMetersPerSecond = (degreesPerSecond, limb) => {
    const angularVelocityRadPerSec = (Number(degreesPerSecond) || 0) * (Math.PI / 180);
    const linearVelocityMetersPerSec = angularVelocityRadPerSec * getVelocityRadiusMeters(limb);
    return +(linearVelocityMetersPerSec.toFixed(2));
};

export function BleProvider({ children }) {
    const [connectedDevice, setConnectedDevice] = useState(null);
    const [secondaryDevice, setSecondaryDevice] = useState(null);
    const [feedback, setFeedback] = useState(initialFeedback);
    const [secondaryFeedback, setSecondaryFeedback] = useState(initialFeedback);
    const [batteryLevels, setBatteryLevels] = useState({ primary: null, secondary: null });
    const [showDeviceModal, setShowDeviceModal] = useState(false);
    const [scannedDevices, setScannedDevices] = useState([]);
    const [connecting, setConnecting] = useState(false);
    const [bleState, setBleState] = useState(null);
    const [deviceSlotToConnect, setDeviceSlotToConnect] = useState('primary');
    const [deviceSettings, setDeviceSettings] = useState(defaultDeviceSettings);
    const permissionTimeoutRef = useRef(null);
    const scanTimeoutRef = useRef(null);
    const monitorSubscriptionsRef = useRef({ primary: [], secondary: [] });
    const disconnectSubscriptionsRef = useRef({});
    const connectedDeviceRef = useRef(null);
    const secondaryDeviceRef = useRef(null);

    useEffect(() => {
        connectedDeviceRef.current = connectedDevice;
    }, [connectedDevice]);

    useEffect(() => {
        secondaryDeviceRef.current = secondaryDevice;
    }, [secondaryDevice]);

    const requestBlePermissions = useCallback(async () => {
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
    }, []);

    const schedulePermissionRequest = useCallback(() => {
        if (permissionTimeoutRef.current) {
            clearTimeout(permissionTimeoutRef.current);
        }
        permissionTimeoutRef.current = setTimeout(() => {
            requestBlePermissions();
            permissionTimeoutRef.current = null;
        }, 30000);
    }, [requestBlePermissions]);

    const clearMonitorSubscriptions = useCallback((slot) => {
        monitorSubscriptionsRef.current[slot]?.forEach((subscription) => {
            try {
                subscription?.remove?.();
            } catch { }
        });
        monitorSubscriptionsRef.current[slot] = [];

        ['ROM', 'TUT', 'Velocity', 'Current Position', 'reps', 'sets', 'exerciseStage'].forEach((label) => {
            try {
                bleManager.cancelTransaction(`workoutstream-${slot}-${label}`);
            } catch { }
        });
    }, []);

    const stopScan = useCallback(() => {
        if (scanTimeoutRef.current) {
            clearTimeout(scanTimeoutRef.current);
            scanTimeoutRef.current = null;
        }
        try {
            bleManager.stopDeviceScan();
        } catch { }
        setConnecting(false);
    }, []);

    const cancelScan = useCallback(() => {
        stopScan();
        setShowDeviceModal(false);
    }, [stopScan]);

    const updateFeedbackForSlot = useCallback((slot, label, value) => {
        const setter = slot === 'secondary' ? setSecondaryFeedback : setFeedback;
        setter((prev) => {
            const next = { ...prev };
            if (label === 'Velocity') {
                const limb = deviceSettings?.[slot]?.limb ?? ExerciseLimb.undefined.value;
                const degreesPerSecond = (Number(value) || 0) / 100;
                next.Velocity = convertDegreesPerSecondToMetersPerSecond(degreesPerSecond, limb);
            }
            if (label === 'TUT') next.TUT = +((value / 1000).toFixed(2));
            if (label === 'ROM') next.ROM = value;
            if (label === 'Current Position') next['Current Position'] = value;
            if (label === 'reps') next.reps = value;
            if (label === 'sets') {
                next.sets = value;
                next.setc = value;
            }
            if (label === 'exerciseStage') next.exerciseStage = value;
            if (label === 'ROM') next.Score = value > 120 ? 100 : value > 90 ? 50 : 0;
            return next;
        });
    }, [deviceSettings]);

    const readCurrentPosition = useCallback(async (dev = null, slot = 'primary') => {
        const device = dev || connectedDevice;
        if (!device) return;
        try {
            const ch = await device.readCharacteristicForService(
                SERVICE_UUIDS.deviceStatus,
                CHARACTERISTICS.currentPosition
            );
            const raw = base64.decode(ch.value || '');
            const buf = Uint8Array.from(raw.split('').map((c) => c.charCodeAt(0)));
            const v = buf[0] ?? 0;
            updateFeedbackForSlot(slot, 'Current Position', v);
        } catch (e) {
            console.warn('Read current position failed:', e?.message || e);
        }
    }, [connectedDevice, updateFeedbackForSlot]);

    const readBatteryLevel = useCallback(async (slot = 'primary', dev = null) => {
        const device =
            dev ||
            (slot === 'primary' ? connectedDeviceRef.current : secondaryDeviceRef.current);
        if (!device) return null;

        try {
            const ch = await device.readCharacteristicForService(
                BleUuids.batteryService,
                BleUuids.batteryLevel
            );
            const raw = base64.decode(ch.value || '');
            const level = raw.charCodeAt(0);
            if (!Number.isFinite(level)) return null;
            setBatteryLevels((prev) => ({ ...prev, [slot]: level }));
            return level;
        } catch (e) {
            console.warn('Read battery level failed:', e?.message || e);
            return null;
        }
    }, []);

    const monitor = useCallback(
        (device, slot = 'primary') => {
            clearMonitorSubscriptions(slot);

            const watch = (svc, chr, label, fmt) => {
                const transactionId = `workoutstream-${slot}-${label}`;
                const subscription = device.monitorCharacteristicForService(
                    svc,
                    chr,
                    (err, characteristic) => {
                        if (err) {
                            const message = (err?.message || '').toLowerCase();
                            if (message.includes('operation was cancelled')) {
                                return;
                            }
                            return console.warn(err);
                        }
                        const raw = base64.decode(characteristic.value || '');
                        const buf = Uint8Array.from(raw.split('').map((c) => c.charCodeAt(0)));
                        let value = 0;
                        if (fmt === 'UINT8') value = buf[0] ?? 0;
                        if (fmt === 'UINT16') value = (buf[0] ?? 0) + ((buf[1] ?? 0) << 8);
                        if (fmt === 'UINT32') {
                            value =
                                (buf[0] ?? 0) +
                                ((buf[1] ?? 0) << 8) +
                                ((buf[2] ?? 0) << 16) +
                                ((buf[3] ?? 0) << 24);
                        }
                        updateFeedbackForSlot(slot, label, value);
                    },
                    transactionId
                );
                monitorSubscriptionsRef.current[slot].push(subscription);
            };

            watch(SERVICE_UUIDS.deviceStatus, CHARACTERISTICS.rom, 'ROM', 'UINT8');
            watch(SERVICE_UUIDS.deviceStatus, CHARACTERISTICS.tut, 'TUT', 'UINT32');
            watch(SERVICE_UUIDS.deviceStatus, CHARACTERISTICS.velocity, 'Velocity', 'UINT16');
            watch(SERVICE_UUIDS.deviceStatus, CHARACTERISTICS.currentPosition, 'Current Position', 'UINT8');
            watch(SERVICE_UUIDS.deviceStatus, CHARACTERISTICS.reps, 'reps', 'UINT16');
            watch(SERVICE_UUIDS.deviceStatus, CHARACTERISTICS.sets, 'sets', 'UINT8');
            watch(SERVICE_UUIDS.deviceStatus, CHARACTERISTICS.exerciseStage, 'exerciseStage', 'UINT8');
        },
        [clearMonitorSubscriptions, updateFeedbackForSlot]
    );

    const disconnect = useCallback(
        async (slot = 'primary') => {
            const target = slot === 'primary' ? connectedDevice : secondaryDevice;
            if (!target) return;
            try {
                clearMonitorSubscriptions(slot);
                disconnectSubscriptionsRef.current[slot]?.remove?.();
                disconnectSubscriptionsRef.current[slot] = null;
                await bleManager.cancelDeviceConnection(target.id);
            } catch (e) {
                console.warn('Disconnect error', e?.message || e);
            } finally {
                if (slot === 'primary') {
                    setConnectedDevice(null);
                    setBatteryLevels((prev) => ({ ...prev, primary: null }));
                    setFeedback(initialFeedback);
                } else {
                    setSecondaryDevice(null);
                    setBatteryLevels((prev) => ({ ...prev, secondary: null }));
                    setSecondaryFeedback(initialFeedback);
                }
            }
        },
        [clearMonitorSubscriptions, connectedDevice, secondaryDevice]
    );

    const connectDevice = useCallback(
        async (device, slot = 'primary') => {
            if (!device?.id) return;
            const primary = connectedDeviceRef.current;
            const secondary = secondaryDeviceRef.current;
            const alreadyConnected =
                (primary?.id === device.id && slot !== 'primary') ||
                (secondary?.id === device.id && slot !== 'secondary');

            if (alreadyConnected) {
                Alert.alert('Already connected', 'That sensor is already connected in another slot.');
                return;
            }

            try {
                stopScan();
                setConnecting(true);
                await new Promise((resolve) => setTimeout(resolve, 300));
                const connected = await device.connect({ timeout: 15000 });
                const ready = await connected.discoverAllServicesAndCharacteristics();
                disconnectSubscriptionsRef.current[slot]?.remove?.();
                disconnectSubscriptionsRef.current[slot] = bleManager.onDeviceDisconnected(ready.id, () => {
                    console.log('Device disconnected');
                    clearMonitorSubscriptions(slot);
                    if (slot === 'primary') {
                        setConnectedDevice(null);
                        setBatteryLevels((prev) => ({ ...prev, primary: null }));
                        setFeedback(initialFeedback);
                    } else {
                        setSecondaryDevice(null);
                        setBatteryLevels((prev) => ({ ...prev, secondary: null }));
                        setSecondaryFeedback(initialFeedback);
                    }
                });
                if (slot === 'primary') {
                    setConnectedDevice(ready);
                    monitor(ready, 'primary');
                    await readCurrentPosition(ready, 'primary');
                    await readBatteryLevel('primary', ready);
                } else {
                    setSecondaryDevice(ready);
                    monitor(ready, 'secondary');
                    await readCurrentPosition(ready, 'secondary');
                    await readBatteryLevel('secondary', ready);
                }
                const roleLabel = slot === 'primary' ? '' : ' (secondary)';
                Alert.alert('Connected', `Connected to ${device.name || 'device'}${roleLabel}`);
            } catch (e) {
                Alert.alert('Connect error', e?.message || 'Unable to connect to device.');
            } finally {
                stopScan();
                setShowDeviceModal(false);
            }
        },
        [clearMonitorSubscriptions, monitor, readBatteryLevel, readCurrentPosition, stopScan]
    );

    const handleDeviceSelect = useCallback(
        (device) => {
            if (!device) return;
            connectDevice(device, deviceSlotToConnect);
        },
        [connectDevice, deviceSlotToConnect]
    );

    const flashDevice = useCallback(async (slot = 'primary') => {
        const device = slot === 'primary' ? connectedDeviceRef.current : secondaryDeviceRef.current;
        if (!device) {
            Alert.alert('Not connected', 'Connect a device first.');
            return;
        }

        const bytes = Array.from(createCommand(DeviceCommands.id));
        const payload = base64.encode(String.fromCharCode(...bytes));
        console.log('BLE flash command write', {
            slot,
            deviceId: device.id,
            deviceName: device.name || null,
            bytes,
            base64: payload,
        });

        try {
            await device.writeCharacteristicWithResponseForService(
                BleUuids.deviceCommandService,
                BleUuids.command,
                payload
            );
        } catch {
            await device.writeCharacteristicWithoutResponseForService(
                BleUuids.deviceCommandService,
                BleUuids.command,
                payload
            );
        }
    }, []);

    const updateDeviceSetting = useCallback((slot, key, value) => {
        setDeviceSettings((prev) => ({
            ...prev,
            [slot]: {
                ...(prev[slot] || {}),
                [key]: value,
            },
        }));
    }, []);

    const scanAndConnect = useCallback(
        async (slot = 'primary') => {
            setDeviceSlotToConnect(slot);
            await requestBlePermissions();
            if (bleState && bleState !== 'PoweredOn') {
                Alert.alert('Bluetooth Off', 'Please enable Bluetooth to connect to a device.');
                return;
            }
            stopScan();
            setScannedDevices([]);
            setShowDeviceModal(true);
            setConnecting(true);

            bleManager.startDeviceScan(null, null, (error, device) => {
                if (error) {
                    stopScan();
                    setShowDeviceModal(false);
                    Alert.alert('Scan Error', error.message || 'Unable to scan for BLE devices.');
                    return;
                }

                if (!device?.id) {
                    return;
                }

                const connectedIds = [
                    connectedDeviceRef.current?.id,
                    secondaryDeviceRef.current?.id,
                ].filter(Boolean);
                if (connectedIds.includes(device.id)) return;

                const name = (device.name || '').toLowerCase();
                if (!name.startsWith(BLE_CONSTANTS.DEVICE_NAME_PREFIX)) return;

                setScannedDevices((prev) => {
                    if (prev.some((d) => d.id === device.id)) {
                        return prev;
                    }
                    return [...prev, device];
                });
            });

            scanTimeoutRef.current = setTimeout(() => {
                stopScan();
            }, BLE_CONSTANTS.SCAN_TIMEOUT);
        },
        [bleState, requestBlePermissions, stopScan]
    );

    useEffect(() => {
        schedulePermissionRequest();
        const appStateSub = AppState.addEventListener('change', (state) => {
            if (state === 'active') {
                schedulePermissionRequest();
            }
        });
        const subscription = bleManager.onStateChange((state) => {
            setBleState(state);
        }, true);
        bleManager.state().then(setBleState).catch(() => { });
        return () => {
            if (permissionTimeoutRef.current) {
                clearTimeout(permissionTimeoutRef.current);
                permissionTimeoutRef.current = null;
            }
            stopScan();
            clearMonitorSubscriptions('primary');
            clearMonitorSubscriptions('secondary');
            disconnectSubscriptionsRef.current.primary?.remove?.();
            disconnectSubscriptionsRef.current.secondary?.remove?.();
            subscription?.remove?.();
            appStateSub?.remove?.();
            bleManager.destroy();
        };
    }, [clearMonitorSubscriptions, schedulePermissionRequest, stopScan]);

    useEffect(() => {
        const interval = setInterval(() => {
            if (connectedDeviceRef.current) {
                readBatteryLevel('primary');
            }
            if (secondaryDeviceRef.current) {
                readBatteryLevel('secondary');
            }
        }, 60000);

        return () => clearInterval(interval);
    }, [readBatteryLevel]);

    const value = {
        bleState,
        connectedDevice,
        secondaryDevice,
        feedback,
        secondaryFeedback,
        batteryLevels,
        showDeviceModal,
        scannedDevices,
        connecting,
        deviceSlotToConnect,
        deviceSettings,
        scanAndConnect,
        connectDevice,
        disconnect,
        flashDevice,
        updateDeviceSetting,
        cancelScan,
        handleDeviceSelect,
        readCurrentPosition,
        readBatteryLevel,
    };

    return <BleContext.Provider value={value}>{children}</BleContext.Provider>;
}

export function useBle() {
    const context = useContext(BleContext);
    if (!context) {
        throw new Error('useBle must be used within a BleProvider');
    }
    return context;
}