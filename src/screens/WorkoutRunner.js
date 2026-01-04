
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Button,
  Dimensions,
  FlatList,
  ScrollView,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import base64 from 'react-native-base64';
import { Svg, Polygon, Line, Circle, Text as SvgText } from 'react-native-svg';
import { v4 as uuidv4 } from 'uuid';
import { generateClient } from 'aws-amplify/api';
import { listExercises } from '../graphql/queries';

const WORKOUT_LIBRARY = [
  { label: 'Barbell Bench Press', command: '4,0', aliases: ['Barbell Bench'] },
  { label: 'Bench Dips', command: '4,1' },
  { label: 'Dumbbell Lateral Raises', command: '4,2', aliases: ['Dumbbell Lateral Raise'] },
  { label: 'Dumbbell Single Arm Row', command: '4,3' },
  { label: 'Seated Dumbbell Shoulder Press', command: '4,4', aliases: ['Seated Dumbbell Overhead Shoulder Press'] },
  { label: 'Push Ups', command: '4,5', aliases: ['Push Up Option'] },
  { label: 'Air Squats', command: '4,6', aliases: ['Air Squat Option'] },
  { label: 'Barbell Deadlift', command: '4,7' },
  { label: 'Barbell Back Squat', command: '4,8' },
  { label: 'Bodyweight Front Lunges', command: '4,9', aliases: ['Front Lunges'] },
  { label: 'Laying Leg Raises', command: '4,10' },
  { label: 'Mountain Climbers', command: '4,11' },
  {
    label: 'Dumbbell Squat and Overhead Press',
    command: '4,12',
    secondaryCommand: '4,13',
    aliases: ['Weighted Squat and Overhead Press'],
  },
];

const WORKOUT_COMMANDS = WORKOUT_LIBRARY.reduce((acc, workout) => {
  acc[workout.label] = workout;
  if (Array.isArray(workout.aliases)) {
    workout.aliases.forEach((alias) => {
      acc[alias] = workout;
    });
  }
  return acc;
}, {});

const DEFAULT_WORKOUT_OPTIONS = WORKOUT_LIBRARY.map((item) => item.label);
const normalizeLabel = (value) => {
  if (!value) return '';
  if (typeof value === 'object') {
    if (value.S !== undefined) return value.S;
    if (value.value !== undefined) return value.value;
  }
  if (typeof value === 'string' && value.startsWith('{S=') && value.endsWith('}')) {
    return value.slice(3, -1);
  }
  return value;
};
const toNumberValue = (value) => {
  if (value && typeof value === 'object') {
    if (value.N !== undefined) return Number(value.N);
    if (typeof value.value === 'number') return value.value;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};
const screenWidth = Dimensions.get('window').width;
const bleManager = new BleManager();

const SERVICE_UUIDS = {
  deviceStatus: 'eae2f5f4-b18f-4f4d-0001-100000000000',
  command: 'eae2f5f4-b18f-4f4d-0002-100000000000',
};

const CHARACTERISTICS = {
  rom: 'eae2f5f4-b18f-4f4d-0001-100000000002',
  tut: 'eae2f5f4-b18f-4f4d-0001-100000000003',
  velocity: 'eae2f5f4-b18f-4f4d-0001-100000000005',
  currentPosition: 'eae2f5f4-b18f-4f4d-0001-100000000001',
  command: 'eae2f5f4-b18f-4f4d-0002-100000000001',
  reps: 'eae2f5f4-b18f-4f4d-0001-100000000004',
  sets: 'eae2f5f4-b18f-4f4d-0001-100000000006',
};

const tutOptions = [
  { label: 'Easy', value: 1 },
  { label: 'Moderate', value: 3 },
  { label: 'Intense', value: 5 },
];

const velOptions = [
  { label: 'Easy', value: 1.3 },
  { label: 'Moderate', value: 0.75 },
  { label: 'Intense', value: 0.5 },
];
const LOAD_OPTIONS = [2.5, 5, 10, 25, 35, 45];

function SvgRadarChart({ data, size = 200, max = 100 }) {
  const margin = 40;
  const full = size + margin * 2;
  const R = size / 2;
  const center = { x: full / 2, y: full / 2 };
  const N = data.length;
  const slice = (2 * Math.PI) / N;

  const rings = [...Array(5).keys()].map((i) => {
    const r = R * ((5 - i) / 5);
    const value = Math.round(max * ((5 - i) / 5));
    const points = [...Array(N).keys()]
      .map((j) => {
        const a = slice * j - Math.PI / 2;
        return `${center.x + r * Math.cos(a)},${center.y + r * Math.sin(a)}`;
      })
      .join(' ');
    return (
      <React.Fragment key={`ring-${i}`}>
        <Polygon points={points} stroke="#DDD" fill="none" />
        <SvgText
          x={center.x + 4}
          y={center.y - r + 4}
          fill="#999"
          fontSize="10"
          textAnchor="start"
        >
          {value}
        </SvgText>
      </React.Fragment>
    );
  });

  const axes = [...Array(N).keys()].map((i) => {
    const a = slice * i - Math.PI / 2;
    return (
      <Line
        key={`axis-${i}`}
        x1={center.x}
        y1={center.y}
        x2={center.x + R * Math.cos(a)}
        y2={center.y + R * Math.sin(a)}
        stroke="#EEE"
      />
    );
  });

  const pts = data.map((d, i) => {
    const a = slice * i - Math.PI / 2;
    const r = (d.value / max) * R;
    return {
      x: center.x + r * Math.cos(a),
      y: center.y + r * Math.sin(a),
      label: d.value,
    };
  });

  const labels = data.map((d, i) => {
    const a = slice * i - Math.PI / 2;
    const r = R + margin / 2;
    const x = center.x + r * Math.cos(a);
    const y = center.y + r * Math.sin(a);
    let anchor = 'middle';
    if (Math.cos(a) > 0.3) anchor = 'start';
    else if (Math.cos(a) < -0.3) anchor = 'end';
    return (
      <SvgText
        key={`label-${i}`}
        x={x}
        y={y}
        fill="#FF4136"
        fontSize="14"
        fontWeight="bold"
        textAnchor={anchor}
      >
        {d.title}
      </SvgText>
    );
  });

  return (
    <Svg width={full} height={full}>
      {rings}
      {axes}
      <Polygon
        points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="rgba(0,122,255,0.3)"
        stroke="#007AFF"
        strokeWidth={2}
      />
      {pts.map((p, i) => (
        <React.Fragment key={`point-${i}`}>
          <Circle cx={p.x} cy={p.y} r={4} fill="#007AFF" />
          <SvgText
            x={p.x}
            y={p.y - 8}
            fill="#007AFF"
            fontSize="12"
            fontWeight="bold"
            textAnchor="middle"
          >
            {p.label}
          </SvgText>
        </React.Fragment>
      ))}
      {labels}
    </Svg>
  );
}

const getBarColor = (value) => {
  const v = Math.max(0, Math.min(100, value));
  if (v < 25) return '#ef4444'; // red
  if (v < 50) return '#f97316'; // orange
  if (v < 75) return '#facc15'; // yellow
  return '#22c55e'; // green
};
const getRomBarColor = (value) => {
  const v = Math.max(0, Math.min(100, value));
  if (v < 70) return '#ef4444';
  if (v < 80) return '#facc15';
  return '#22c55e';
};
const getThreshold70Color = (value) => {
  const v = Math.max(0, Math.min(100, value));
  if (v < 70) return '#ef4444';
  if (v < 80) return '#facc15';
  return '#22c55e';
};

const IntensityBars = ({ data, onInfo }) => {
  return (
    <View style={{ width: '100%', gap: 12 }}>
      {data.map((item, idx) => {
        const widthPct = Math.max(0, Math.min(100, item.value));
        const displayVal =
          item.display !== undefined && item.display !== null
            ? item.display
            : widthPct;
        const decimals =
          item.decimals !== undefined
            ? item.decimals
            : item.rom || item.title === 'Score'
              ? 0
              : 2;
        const color = item.rom
          ? getRomBarColor(widthPct)
          : item.threshold70
            ? getThreshold70Color(widthPct)
            : getBarColor(widthPct);
        return (
          <View key={`${item.title}-${idx}`} style={styles.barRow}>
            <View style={styles.barTitleRow}>
              <Text style={[styles.barLabel, { fontSize: 16 }]}>{item.title}</Text>
              <Pressable
                hitSlop={8}
                onPress={() => onInfo && onInfo(item)}
                style={styles.infoIconWrap}
              >
                <Text style={styles.infoIcon}>ℹ️</Text>
              </Pressable>
            </View>
            <View style={[styles.barTrack, { height: 14, borderRadius: 10 }]}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${widthPct}%`,
                    backgroundColor: color,
                  },
                ]}
              />
            </View>
            <Text style={styles.barValue}>
              {Number(displayVal).toFixed ? Number(displayVal).toFixed(decimals) : displayVal}
            </Text>
          </View>
        );
      })}
    </View>
  );
};

export default function WorkoutRunner({ route }) {
  const workoutPlan = route?.params?.workoutPlan || null;
  const scheduledItems = Array.isArray(workoutPlan?.items) ? workoutPlan.items : [];
  const normalizedPlanItems = useMemo(() => {
    if (!Array.isArray(scheduledItems)) return [];
    return scheduledItems.map((entry, index) => {
      const label = normalizeLabel(entry?.exercise_id || entry?.name);
      return {
        ...entry,
        label: label || `Exercise ${entry?.workout_item_index || index + 1}`,
        workout_item_index: entry?.workout_item_index ?? index + 1,
        muscle_focus: normalizeLabel(entry?.muscle_focus || entry?.category || 'General'),
        target_sets: toNumberValue(entry?.target_sets) ?? 0,
        target_reps: toNumberValue(entry?.target_reps) ?? 0,
        exerciseId: normalizeLabel(entry?.exercise_id) || label || `exercise-${index + 1}`,
      };
    });
  }, [scheduledItems]);
  const planMetaByLabel = useMemo(() => {
    const map = {};
    normalizedPlanItems.forEach((entry) => {
      if (entry.label) {
        map[entry.label] = entry;
      }
    });
    return map;
  }, [normalizedPlanItems]);
  const [rows, setRows] = useState([]);
  const completionByExercise = useMemo(() => {
    const map = {};
    rows.forEach((row) => {
      const label = normalizeLabel(row?.workout);
      if (!label) return;
      if (!map[label]) map[label] = new Set();
      const key =
        row?.setNo && String(row.setNo).trim()
          ? String(row.setNo).trim()
          : `entry-${map[label].size + 1}-${row.id || Math.random()}`;
      map[label].add(key);
    });
    const counts = {};
    Object.keys(map).forEach((label) => {
      counts[label] = map[label].size;
    });
    return counts;
  }, [rows]);
  const [openPickerId, setOpenPickerId] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const workoutOptions = useMemo(() => {
    if (normalizedPlanItems.length) {
      const labels = normalizedPlanItems.map((entry) => entry.label).filter(Boolean);
      const unique = Array.from(new Set(labels));
      if (unique.length) return unique;
    }
    return DEFAULT_WORKOUT_OPTIONS;
  }, [normalizedPlanItems]);
const [selectedWorkout, setSelectedWorkout] = useState(
  workoutOptions[0] || DEFAULT_WORKOUT_OPTIONS[0]
);
const [readyModalVisible, setReadyModalVisible] = useState(false);
const [pendingWorkout, setPendingWorkout] = useState(null);
const handleInfo = useCallback(
  (item) => {
    if (!item?.info) return;
    setInfoModal({ visible: true, title: item.title, text: item.info });
  },
  []
);
const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
const [connectedDevice, setConDev] = useState(null);
const [secondaryDevice, setSecondaryDevice] = useState(null);
const [exerciseMap, setExerciseMap] = useState({});
const [feedback, setFeedback] = useState({
  ROM: 0,
  TUT: 0,
  Velocity: 0,
  Score: 0,
  'Current Position': 0,
  reps: 0,
  sets: 0,
});
const [secondaryFeedback, setSecondaryFeedback] = useState({ ROM: 0 });
  const [tutLevel, setTutLevel] = useState(0);
  const [velLevel, setVelLevel] = useState(0);
  const [weight, setWeight] = useState(0);
  const [repSnapshots, setRepSnapshots] = useState([]);
  const [velocityArray, setVelocityArray] = useState([]);
  const [forceArray, setForceArray] = useState([]);
  const [summary, setSummary] = useState(null);
  const [summaryModalVisible, setSummaryModalVisible] = useState(false);
  const [savingWorkout, setSavingWorkout] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [scannedDevices, setScannedDevices] = useState([]);
  const [connecting, setConnecting] = useState(false);
  const [bleState, setBleState] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [deviceSlotToConnect, setDeviceSlotToConnect] = useState('primary');
  const sessionIdRef = useRef(null);
  const sessionItemIndexMap = useRef({});
  const sessionItemCounterRef = useRef(0);
  const sessionRepCountMap = useRef({});
  const customerId = route?.params?.customer_id || null;
  const [maxRom, setMaxRom] = useState(120);
  const prevRepsRef = useRef(0);
  const prevSetsRef = useRef(0);
  const weightRef = useRef(0);
  const workoutRef = useRef(workoutOptions[0] || DEFAULT_WORKOUT_OPTIONS[0]);
  const feedbackRef = useRef(feedback);
  const secondaryFeedbackRef = useRef(secondaryFeedback);
  const permissionTimeoutRef = useRef(null);
  const [infoModal, setInfoModal] = useState({ visible: false, title: '', text: '' });

  const maxTUT = tutOptions[tutLevel]?.value || 1;
  const maxVelocity = velOptions[velLevel]?.value || 1;
  const currentWorkoutItem = useMemo(() => {
    const key = (pendingWorkout || selectedWorkout || '').toLowerCase();
    if (!key) return null;
    return (
      normalizedPlanItems.find((item) => {
        const lbl = normalizeLabel(item?.exercise_id || item?.name || '').toLowerCase();
        return lbl && (lbl === key || key.includes(lbl) || lbl.includes(key));
      }) || null
    );
  }, [pendingWorkout, selectedWorkout, normalizedPlanItems]);
  const showManualTargets = !currentWorkoutItem?.workout_id;

  const average = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const adjustWeight = useCallback(
    (delta) => {
      setWeight((prev) => {
        const next = (Number(prev) || 0) + delta;
        return next < 0 ? 0 : +next.toFixed(2);
      });
    },
    [setWeight]
  );
  useEffect(() => {
    feedbackRef.current = feedback;
  }, [feedback]);
  useEffect(() => {
    secondaryFeedbackRef.current = secondaryFeedback;
  }, [secondaryFeedback]);

  useEffect(() => {
    weightRef.current = weight;
  }, [weight]);

  useEffect(() => {
    const loadExercises = async () => {
      try {
        const { data } = await client.graphql({ query: listExercises, variables: { limit: 500 } });
        const list = Array.isArray(data?.listExercises?.items) ? data.listExercises.items : [];
        const map = {};
        list.forEach((ex) => {
          if (!ex?.exercise_id) return;
          map[ex.exercise_id] = ex;
          if (ex.name) map[ex.name] = ex;
        });
        setExerciseMap(map);
      } catch (err) {
        console.log('Fetch exercises failed', err);
      }
    };
    loadExercises();
  }, [client]);

  useEffect(() => {
    if (!workoutOptions.length) return;
    setSelectedWorkout((prev) => (workoutOptions.includes(prev) ? prev : workoutOptions[0]));
    if (!workoutOptions.includes(workoutRef.current)) {
      workoutRef.current = workoutOptions[0];
    }
  }, [workoutOptions]);

  useEffect(() => {
    workoutRef.current = selectedWorkout;
  }, [selectedWorkout]);

  const getCompletionPercent = useCallback(
    (entry) => {
      const label = entry?.label || normalizeLabel(entry?.exercise_id || entry?.name);
      const completed = completionByExercise[label] || 0;
      const totalSets = entry?.target_sets || entry?.target_sets === 0 ? entry.target_sets : 0;
      if (!totalSets) {
        return completed > 0 ? 100 : 0;
      }
      return Math.min(100, Math.round((completed / totalSets) * 100));
    },
    [completionByExercise]
  );

  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const requestBlePermissions = useCallback(async () => {
    if (Platform.OS === 'android') {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
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
    bleManager.state().then(setBleState).catch(() => {});
    return () => {
      if (permissionTimeoutRef.current) {
        clearTimeout(permissionTimeoutRef.current);
        permissionTimeoutRef.current = null;
      }
      bleManager.destroy();
      subscription?.remove?.();
      appStateSub?.remove?.();
    };
  }, [schedulePermissionRequest]);

  const disconnect = async (slot = 'primary') => {
    const target = slot === 'primary' ? connectedDevice : secondaryDevice;
    if (!target) return;
    try {
      if (slot === 'primary') {
        ['ROM', 'TUT', 'Velocity', 'Current Position', 'reps', 'sets'].forEach((label) => {
          try {
            bleManager.cancelTransaction(`workoutstream-${label}`);
          } catch {}
        });
      }
      await bleManager.cancelDeviceConnection(target.id);
    } catch (e) {
      console.warn('Disconnect error', e?.message || e);
    } finally {
      if (slot === 'primary') {
        setConDev(null);
      } else {
        setSecondaryDevice(null);
      }
    }
  };
  const handleWorkoutSelection = (workout) => {
    setSelectedWorkout(workout);
    setPendingWorkout(workout);
    setReadyModalVisible(true);
  };

  const closeReadyModal = () => {
    setReadyModalVisible(false);
    setPendingWorkout(null);
  };

  const startWorkoutCommand = async () => {
    const key = pendingWorkout || selectedWorkout;
    const config = WORKOUT_COMMANDS[key];
    if (!config) {
      closeReadyModal();
      return;
    }
    try {
      if (config.command) {
        await sendCommand(config.command);
      }
      if (config.secondaryCommand && secondaryDevice) {
        await sendCommand(config.secondaryCommand, secondaryDevice);
      }
    } finally {
      closeReadyModal();
    }
  };

  const scanAndConnect = (slot = 'primary') => {
    setDeviceSlotToConnect(slot);
    if (bleState && bleState !== 'PoweredOn') {
      Alert.alert(
        'Bluetooth Off',
        'Please enable Bluetooth to connect to a device.'
      );
      return;
    }
    bleManager.stopDeviceScan();
    setScannedDevices([]);
    setShowDeviceModal(true);
    setConnecting(true);

    bleManager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        setConnecting(false);
        setShowDeviceModal(false);
        Alert.alert('Scan Error', error.message || 'Unable to scan for BLE devices.');
        return;
      }

      if (!device?.id) {
        return;
      }

      const name = (device.name || '').toLowerCase();
      if (!name.startsWith('bplx')) return;

      setScannedDevices((prev) => {
        if (prev.some((d) => d.id === device.id)) {
          return prev;
        }
        return [...prev, device];
      });
    });

    setTimeout(() => {
      bleManager.stopDeviceScan();
      setConnecting(false);
    }, 10000);
  };

  const readCurrentPosition = async (dev = null) => {
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
      setFeedback((prev) => ({ ...prev, 'Current Position': v }));
    } catch (e) {
      console.warn('Read current position failed:', e?.message || e);
    }
  };

  const connectDevice = async (device, slot = 'primary') => {
    try {
      setConnecting(true);
      const connected = await device.connect();
      const ready = await connected.discoverAllServicesAndCharacteristics();
      bleManager.onDeviceDisconnected(ready.id, () => {
        console.log('Device disconnected');
        if (slot === 'primary') {
          setConDev(null);
        } else {
          setSecondaryDevice(null);
        }
      });
      if (slot === 'primary') {
        setConDev(ready);
        monitor(ready, 'primary');
        await readCurrentPosition(ready);
      } else {
        setSecondaryDevice(ready);
        monitor(ready, 'secondary');
      }
      const roleLabel = slot === 'primary' ? '' : ' (secondary)';
      Alert.alert('Connected', `Connected to ${device.name || 'device'}${roleLabel}`);
    } catch (e) {
      Alert.alert('Connect error', e.message);
    } finally {
      setConnecting(false);
      setShowDeviceModal(false);
      bleManager.stopDeviceScan();
    }
  };

  const handleDeviceSelect = (device) => {
    if (!device) return;
    connectDevice(device, deviceSlotToConnect);
  };

  const monitor = (device, slot = 'primary') => {
    const watch = (svc, chr, label, fmt) => {
      const transactionId = `workoutstream-${slot}-${label}`;
      device.monitorCharacteristicForService(
        svc,
        chr,
        (err, characteristic) => {
          if (err) return console.warn(err);
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
          if (slot === 'secondary' && label === 'ROM') {
            setSecondaryFeedback((prev) => ({ ...prev, ROM: value }));
          } else {
            setFeedback((prev) => {
              const next = { ...prev };
              if (label === 'Velocity') next.Velocity = +((value / 100).toFixed(2));
              if (label === 'TUT') next.TUT = +((value / 1000).toFixed(2));
              if (label === 'ROM') next.ROM = value;
              if (label === 'Current Position') next['Current Position'] = value;
              if (label === 'reps') next.reps = value;
              if (label === 'sets') next.sets = value;
              if (label === 'ROM') next.Score = value > 120 ? 100 : value > 90 ? 50 : 0;
              return next;
            });
          }
        },
        transactionId
      );
    };

    watch(SERVICE_UUIDS.deviceStatus, CHARACTERISTICS.rom, 'ROM', 'UINT8');
    watch(SERVICE_UUIDS.deviceStatus, CHARACTERISTICS.tut, 'TUT', 'UINT32');
    watch(SERVICE_UUIDS.deviceStatus, CHARACTERISTICS.velocity, 'Velocity', 'UINT16');
    watch(SERVICE_UUIDS.deviceStatus, CHARACTERISTICS.currentPosition, 'Current Position', 'UINT8');
    watch(SERVICE_UUIDS.deviceStatus, CHARACTERISTICS.reps, 'reps', 'UINT16');
    watch(SERVICE_UUIDS.deviceStatus, CHARACTERISTICS.sets, 'sets', 'UINT8');
  };

  const sendCommand = async (custom = null, targetDevice = null) => {
    const device = targetDevice || connectedDevice;
    if (!device) {
      Alert.alert('Not connected', 'Connect to a device first.');
      return;
    }

    const cmd = (custom !== null ? custom : inputValue).trim();
    if (!cmd) {
      Alert.alert('No command', 'Enter comma separated bytes.');
      return;
    }

    const bytes = cmd.split(',').map((n) => parseInt(n.trim(), 10));
    if (bytes.some((n) => Number.isNaN(n))) {
      Alert.alert('Invalid command', 'Ensure all entries are numbers.');
      return;
    }

    if (bytes[0] === 4 && bytes.length > 1) {
      const romMap = {
        0: 125,
        1: 90,
        2: 90,
        3: 90,
        4: 90,
        5: 70,
        6: 90,
        7: 30,
        8: 105,
        9: 90,
        10: 135,
        11: 53,
        12: 90,
        13: 90,
      };
      const newMax = romMap[bytes[1]];
      if (newMax !== undefined) {
        setMaxRom(newMax);
      }
    }

    const payload = base64.encode(String.fromCharCode(...bytes));
    try {
      await device.writeCharacteristicWithResponseForService(
        SERVICE_UUIDS.command,
        CHARACTERISTICS.command,
        payload
      );
    } catch {
      await device.writeCharacteristicWithoutResponseForService(
        SERVICE_UUIDS.command,
        CHARACTERISTICS.command,
        payload
      );
    }

    if (device === connectedDevice) {
      readCurrentPosition();
    }
    Keyboard.dismiss();
  };
  useEffect(() => {
    const reps = feedback.reps ?? 0;
    const prevCount = prevRepsRef.current ?? 0;
    if (reps > prevCount) {
      const repsToAdd = reps - prevCount;
      const latest = feedbackRef.current;
      const vel = +(+latest.Velocity || 0).toFixed(2);
      const tutVal = +(+latest.TUT || 0).toFixed(2);
      const romVal = latest.ROM || 0;
      const scoreVal = latest.Score || 0;
      const weightVal = weightRef.current || 0;
      const momentumVal = +(vel * weightVal).toFixed(2);
      const workoutLabel = workoutRef.current;
      const setNumber = latest.sets || 1;

      const newSnapshots = [];
      const newVelocities = [];
      const newMomenta = [];
      const newRows = [];

      for (let i = 0; i < repsToAdd; i++) {
        const repIndex = prevCount + i + 1;
        const rowId = uuidv4();
        const snapshot = {
          repIndex,
          ROM: romVal,
          TUT: tutVal,
          Velocity: vel,
          Score: scoreVal,
          Momentum: momentumVal,
          setNo: setNumber,
          workout: workoutLabel,
          weight: weightVal,
          rowId,
        };
        newSnapshots.push(snapshot);
        newVelocities.push(vel);
        newMomenta.push(momentumVal);
        newRows.push({
          id: rowId,
          workout: workoutLabel,
          setNo: String(setNumber),
          weight: String(weightVal),
          score: String(scoreVal),
          rom: String(romVal),
          tut: tutVal.toString(),
          velocity: vel.toFixed(2),
          momentum: momentumVal.toFixed(2),
          persisted: false,
        });
        console.log('Rep momentum', { repIndex, momentum: momentumVal });
        persistRepSnapshot(snapshot);
      }

      setRepSnapshots((prev) => [...prev, ...newSnapshots]);
      setVelocityArray((prev) => [...prev, ...newVelocities]);
      setForceArray((prev) => [...prev, ...newMomenta]);
      setRows((prev) => [...prev, ...newRows]);
      prevRepsRef.current = reps;
    }
  }, [feedback.reps, persistRepSnapshot]);

  useEffect(() => {
    const sets = feedback.sets;
    if (sets > 0 && sets !== prevSetsRef.current && repSnapshots.length > 0) {
      const arr = [...repSnapshots];
      const now = new Date();
      const summaryObj = {
        SetNumber: sets,
        RepsCompleted: arr.length,
        Score: +average(arr.map((r) => r.Score)).toFixed(2),
        Momentum: +sum(arr.map((r) => r.Momentum)).toFixed(2),
        TUT: +average(arr.map((r) => r.TUT)).toFixed(2),
        Velocity: +average(arr.map((r) => r.Velocity)).toFixed(2),
        ROM: +average(arr.map((r) => r.ROM)).toFixed(2),
        Date: now.toISOString().split('T')[0],
        Time: now.toLocaleTimeString(),
      };
      const setNoValue = arr[0]?.setNo || sets || 1;
      const workoutValue = arr[0]?.workout || workoutRef.current;
      const weightValue = arr[0]?.weight ?? weightRef.current;
      persistSet({ workout: workoutValue, setNo: setNoValue, weight: weightValue });
      setSummary(summaryObj);
      setSummaryModalVisible(true);
      setRepSnapshots([]);
      prevSetsRef.current = sets;
      prevRepsRef.current = 0;
    }
  }, [feedback.sets, repSnapshots, persistSet]);

  const updateRow = (id, key, value) => {
    setRows((prev) => prev.map((item) => (item.id === id ? { ...item, [key]: value } : item)));
  };

  const toNumber = (value) => {
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object') {
      if (value.N !== undefined) {
        const parsed = Number(value.N);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      if (typeof value.value === 'number') {
        return value.value;
      }
    }
    const n = typeof value === 'string' ? parseFloat(value) : Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  const toInt = (value) => Math.round(toNumber(value));

const CREATE_SESSION = /* GraphQL */ `
    mutation CreateSession($input: CreateSessionInput!) {
      createSession(input: $input) {
        session_id
      }
    }
  `;

const CREATE_SESSION_ITEM = /* GraphQL */ `
  mutation CreateSessionItem($input: CreateSessionItemInput!) {
    createSessionItem(input: $input) {
      session_id
      session_item_index
    }
  }
`;

const CREATE_SESSION_ITEM_REP = /* GraphQL */ `
    mutation CreateSessionItemRep($input: CreateSessionItemRepInput!) {
      createSessionItemRep(input: $input) {
        session_id
        session_item_index
        session_item_set_index
        session_item_rep_index
      }
    }
`;

const CREATE_SESSION_ITEM_SET = /* GraphQL */ `
  mutation CreateSessionItemSet($input: CreateSessionItemSetInput!) {
    createSessionItemSet(input: $input) {
      session_id
      session_item_index
      session_item_set_index
    }
  }
`;

  const resetSessionMaps = useCallback(() => {
    sessionItemIndexMap.current = {};
    sessionRepCountMap.current = {};
    sessionItemCounterRef.current = 0;
  }, []);

  const ensureSession = useCallback(async () => {
    if (!customerId) {
      return null;
    }
    if (sessionIdRef.current) {
      return sessionIdRef.current;
    }
    const session_id = uuidv4();
    const workout_date = new Date().toISOString();
    const workout_id = workoutPlan?.workout_id || null;
    await client.graphql({
      query: CREATE_SESSION,
      variables: { input: { session_id, customer_id: customerId, workout_id, workout_date } },
    });
    sessionIdRef.current = session_id;
    resetSessionMaps();
    setCurrentSessionId(session_id);
    return session_id;
  }, [client, customerId, workoutPlan?.workout_id, resetSessionMaps]);

  const createSessionItemRecord = useCallback(
    async ({ session_id, session_item_index, workout, setIndex }) => {
      try {
        const meta = planMetaByLabel[workout] || null;
        await client.graphql({
          query: CREATE_SESSION_ITEM,
          variables: {
            input: {
              session_id,
              session_item_index,
              workout_id: workoutPlan?.workout_id || null,
              workout_index: setIndex,
              exercise_id: meta?.exerciseId || workout || 'Unknown',
              muscle_focus: meta?.muscle_focus || null,
            },
          },
        });
      } catch (err) {
        console.log('Create session item failed', err);
      }
    },
    [client, workoutPlan?.workout_id, planMetaByLabel]
  );

  const persistRepSnapshot = useCallback(
    async (snapshot) => {
      if (!customerId) return;
      const session_id = await ensureSession();
      if (!session_id) return;

      const safeWorkout = snapshot.workout || workoutRef.current || 'Unknown';
      const rawSetNo = snapshot.setNo || 1;
      const setIndex = Number.parseInt(rawSetNo, 10) || 1;
      const key = `${safeWorkout}||${setIndex}`;
      if (!sessionItemIndexMap.current[key]) {
        sessionItemCounterRef.current += 1;
        sessionItemIndexMap.current[key] = sessionItemCounterRef.current;
        sessionRepCountMap.current[key] = 0;
        await createSessionItemRecord({
          session_id,
          session_item_index: sessionItemCounterRef.current,
          workout: safeWorkout,
          setIndex,
        });
      }
      sessionRepCountMap.current[key] = (sessionRepCountMap.current[key] || 0) + 1;
      const session_item_index = sessionItemIndexMap.current[key];
      const session_item_rep_index = sessionRepCountMap.current[key];
      const session_item_set_index = setIndex;

      const input = {
        session_id,
        session_item_index,
        session_item_set_index,
        session_item_rep_index,
        rom: toInt(snapshot.ROM),
        score: toInt(snapshot.Score),
        tut: toNumber(snapshot.TUT),
        velocity: toInt(snapshot.Velocity),
        momentum: toInt(snapshot.Momentum),
      };
      try {
        await client.graphql({
          query: CREATE_SESSION_ITEM_REP,
          variables: { input },
        });
        if (snapshot.rowId) {
          setRows((prev) =>
            prev.map((row) => (row.id === snapshot.rowId ? { ...row, persisted: true } : row))
          );
        }
      } catch (err) {
        console.warn('Auto save rep failed', err?.message || err);
      }
    },
    [client, customerId, ensureSession, createSessionItemRecord]
  );

const persistSet = useCallback(
    async ({ workout, setNo, weight }) => {
      const session_id = await ensureSession();
      if (!session_id) return;
      const safeWorkout = workout || workoutRef.current || 'Unknown';
      const setIndex = Number.parseInt(setNo, 10) || 1;
      const key = `${safeWorkout}||${setIndex}`;
      const session_item_index = sessionItemIndexMap.current[key];
      if (!session_item_index) return;
      try {
        await client.graphql({
          query: CREATE_SESSION_ITEM_SET,
          variables: {
            input: {
              session_id,
              session_item_index,
              session_item_set_index: setIndex,
              weight_lifted: Number(weight) || 0,
            },
          },
        });
      } catch (err) {
        console.log('Persist set failed', err);
      }
    },
    [client, ensureSession]
  );

  const saveSession = async () => {
    const pendingRows = rows.filter((row) => !row.persisted);
    if (!rows.length) {
      Alert.alert('No data', 'No reps recorded yet.');
      return;
    }
    if (!pendingRows.length) {
      Alert.alert('Synced', 'All reps have already been synced to the cloud.');
      setShowSummary(false);
      return;
    }
    try {
      if (!customerId) {
        Alert.alert('Missing customer', 'No customer_id provided in navigation params.');
        return;
      }
      const session_id = await ensureSession();
      if (!session_id) {
        Alert.alert('Unable to start session', 'Session could not be initialized.');
        return;
      }

      const groups = {};
      const order = [];
      pendingRows.forEach((row) => {
        const workout = row.workout || selectedWorkout;
        const setNo = row.setNo && String(row.setNo).trim() !== '' ? String(row.setNo).trim() : '1';
        const key = `${workout}||${setNo}`;
        if (!groups[key]) {
          groups[key] = [];
          order.push(key);
        }
        groups[key].push(row);
      });

      const promises = [];
      for (let gi = 0; gi < order.length; gi++) {
        const key = order[gi];
        const [workout, setNoStr] = key.split('||');
        const session_item_index = gi + 1;
        const setIndex = parseInt(setNoStr, 10) || 1;
        await createSessionItemRecord({
          session_id,
          session_item_index,
          workout,
          setIndex,
        });
        groups[key].forEach((row, repIdx) => {
          const session_item_rep_index = repIdx + 1;
          const rom = toInt(row.rom);
          const score = toInt(row.score);
          const tut = toNumber(row.tut);
          const velocity = toInt(row.velocity);
          const momentum = toInt(row.momentum);
          promises.push(
            client.graphql({
              query: CREATE_SESSION_ITEM_REP,
              variables: {
                input: {
                  session_id,
                  session_item_index,
                  session_item_set_index: setIndex,
                  session_item_rep_index,
                  rom,
                  score,
                  tut,
                  velocity,
                  momentum,
                },
              },
            })
          );
        });
      }

      await Promise.all(promises);
      Alert.alert('Saved', 'Session saved successfully.');
      setShowSummary(false);
      setRows((prev) => prev.map((row) => ({ ...row, persisted: true })));
    } catch (e) {
      console.log('Save session failed:', e);
      Alert.alert('Error', 'Failed to save the session. See console logs.');
    }
  };

  const handleSaveWorkout = async () => {
    if (savingWorkout) return;
    try {
      setSavingWorkout(true);
      await ensureSession();
      await saveSession();
    } finally {
      setSavingWorkout(false);
    }
  };
  const renderRow = ({ item }) => (
    <View style={styles.card}>
      <View style={{ marginBottom: 8 }}>
        <Pressable
          onPress={() => setOpenPickerId(openPickerId === item.id ? null : item.id)}
          style={styles.select}
        >
          <Text>{item.workout}</Text>
        </Pressable>
        {openPickerId === item.id && (
          <View style={styles.dropdown}>
            {workoutOptions.map((opt) => (
              <Pressable
                key={opt}
                onPress={() => {
                  updateRow(item.id, 'workout', opt);
                  setOpenPickerId(null);
                }}
                style={styles.option}
              >
                <Text>{opt}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      {/* Per-rep manual inputs removed; metrics are shown via intensity bars */}
    </View>
  );

  const renderHeader = () => {
    const handleInfo = (item) => {
      if (!item?.info) return;
      setInfoModal({ visible: true, title: item.title, text: item.info });
    };
    const resolveExercise = () => {
      const label = (pendingWorkout || selectedWorkout || '').toLowerCase();
      const byId = exerciseMap[pendingWorkout || selectedWorkout];
      if (byId) return byId;
      const match = Object.values(exerciseMap).find(
        (ex) => typeof ex?.name === 'string' && ex.name.toLowerCase() === label
      );
      if (match) return match;
      const contains = Object.values(exerciseMap).find(
        (ex) => typeof ex?.name === 'string' && label.includes(ex.name.toLowerCase())
      );
      return contains;
    };
    const currentEx = resolveExercise();
    const targetRomLeg = Number(currentEx?.target_rom_leg) || maxRom;
    const targetRomArm = Number(currentEx?.target_rom_arm) || maxRom;
    const romLegPct = targetRomLeg ? Math.round((feedback.ROM / targetRomLeg) * 100) : 0;
    const romArmPct = targetRomArm ? Math.round((secondaryFeedback.ROM / targetRomArm) * 100) : 0;
    const targetTut = Number(currentWorkoutItem?.target_tut) || maxTUT;
    const targetVelocity = Number(currentWorkoutItem?.target_velocity) || maxVelocity;
    const tutPct = targetTut ? Math.round((feedback.TUT / targetTut) * 100) : 0;
    const velPct = targetVelocity ? Math.round((feedback.Velocity / targetVelocity) * 100) : 0;
    const romScorePct = targetRomLeg
      ? Math.round((feedback.ROM / targetRomLeg) * 100)
      : targetRomArm
        ? Math.round((secondaryFeedback.ROM / targetRomArm) * 100)
        : 0;
    const scoreValue = romScorePct * 0.7 + tutPct * 0.1 + velPct * 0.2;

    const chartData = [
      {
        title: 'Velocity',
        value: velPct,
        display: feedback.Velocity,
        threshold70: true,
        decimals: 2,
        info:
          'Velocity (m/s) measures the speed per rep. It shows how hard it is to move the weight—faster motion generally means higher momentum or force output.',
      },
      {
        title: 'ROM',
        value: romLegPct,
        rom: true,
        display: feedback.ROM,
        decimals: 0,
        info:
          'ROM is a measure of the key joint range of motion (degrees) for the exercise. It reflects form quality; higher ROM usually means better form. It is a key metric in the quality of the rep Score.',
      },
      secondaryDevice
        ? {
            title: 'ROM (Arm)',
            value: romArmPct,
            rom: true,
            display: secondaryFeedback.ROM,
            decimals: 0,
            info:
              'ROM is the joint range of motion (degrees) from the arm sensor. It reflects form quality; higher ROM usually means better form. It also drives the overall rep score. Compared against target_rom_arm for this exercise.',
          }
        : null,
      {
        title: 'TUT',
        value: tutPct,
        display: feedback.TUT,
        threshold70: true,
        decimals: 2,
        info:
          'TUT (time under tension) measures how long your key muscles work per rep. Higher TUT means the muscle is working longer during that rep. It is a key indicator of how well you manage the weight being lifted.',
      },
      {
        title: 'Score',
        value: scoreValue,
        display: scoreValue,
        decimals: 0,
        info:
          'Score is an overall rating derived from the device metrics. It reflects exercise form, control of the weight, and quality of muscle activity during the rep.',
      },
    ]
      .filter(Boolean)
      .map((item) => ({
      ...item,
      value: Number.isFinite(item.value) ? item.value : 0,
    }));
    const maxAxis = Math.max(100, ...chartData.map((d) => d.value));

    return (
      <View style={styles.listHeader}>
        <Text style={styles.header}>Perform Workout</Text>
        {workoutPlan && (
          <View style={styles.planCard}>
            <Text style={styles.planTitle}>{workoutPlan.name || 'Scheduled Workout'}</Text>
            {normalizedPlanItems.length ? (
              normalizedPlanItems.map((entry) => {
                const percent = getCompletionPercent(entry);
                return (
                  <View key={`${entry.workout_id}-${entry.workout_item_index}`} style={styles.planRow}>
                    <Text style={styles.planRowTitle}>
                      {entry.workout_item_index}. {entry.label}
                    </Text>
                    <Text style={styles.planRowMeta}>
                      Focus: {entry.muscle_focus || 'N/A'} · Sets {entry.target_sets || 0} · Reps{' '}
                      {entry.target_reps || 0}
                    </Text>
                    <Text style={styles.planRowMeta}>Progress: {percent}%</Text>
                  </View>
                );
              })
            ) : (
              <Text style={styles.planRowMeta}>No workout items found for this plan.</Text>
            )}
          </View>
        )}

        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>
            Leg Sensor: {connectedDevice ? connectedDevice.name || connectedDevice.id : 'Not connected'}
          </Text>
          {connectedDevice ? (
            <Pressable style={[styles.sensorButton, styles.sensorButtonDanger]} onPress={() => disconnect('primary')}>
              <Text style={styles.sensorButtonText}>Disconnect</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.sensorButton, connecting && styles.sensorButtonDisabled]}
              disabled={connecting}
              onPress={() => scanAndConnect('primary')}
            >
              <Text style={[styles.sensorButtonText, connecting && styles.sensorButtonTextDisabled]}>
                {connecting ? 'Connecting...' : 'Connect Leg Sensor'}
              </Text>
            </Pressable>
          )}
        </View>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>
            Arm Sensor: {secondaryDevice ? secondaryDevice.name || secondaryDevice.id : 'Not connected'}
          </Text>
          {secondaryDevice ? (
            <Pressable
              style={[styles.sensorButton, styles.sensorButtonDanger]}
              onPress={() => disconnect('secondary')}
            >
              <Text style={styles.sensorButtonText}>Disconnect</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.sensorButton, connecting && styles.sensorButtonDisabled]}
              disabled={connecting}
              onPress={() => scanAndConnect('secondary')}
            >
              <Text style={[styles.sensorButtonText, connecting && styles.sensorButtonTextDisabled]}>
                {connecting ? 'Connecting...' : 'Connect Arm Sensor'}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={styles.chipRow}>
          {workoutOptions.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => handleWorkoutSelection(opt)}
              style={[styles.chip, selectedWorkout === opt && styles.chipSelected]}
            >
              <Text style={{ color: selectedWorkout === opt ? '#fff' : '#333' }}>{opt}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.repSetRow}>
          <View style={styles.repSetBox}>
            <Text style={styles.repSetLabel}>Current Rep</Text>
            <Text style={styles.repSetValue}>{feedback.reps ?? 0}</Text>
          </View>
          <View style={styles.repSetBox}>
            <Text style={styles.repSetLabel}>Current Set</Text>
            <Text style={styles.repSetValue}>{feedback.sets ?? 0}</Text>
          </View>
        </View>

        <View style={styles.chartWrap}>
          <IntensityBars data={chartData} onInfo={handleInfo} />
        </View>
        <View style={{ marginTop: 12 }}>
          <Text style={styles.sectionLabel}>Rep Momentum</Text>
          {repSnapshots.length ? (
            (() => {
              const last = repSnapshots[repSnapshots.length - 1] || {};
              const prev = repSnapshots[repSnapshots.length - 2] || null;
              const currentVal = Number(last?.Momentum) || 0;
              const prevVal = prev ? Number(prev.Momentum) || 0 : null;
              let changeText = '—';
              let changeColor = '#334155';
              let arrow = '';
              if (prevVal !== null && prevVal !== 0) {
                const delta = ((currentVal - prevVal) / Math.abs(prevVal)) * 100;
                if (delta > 0) {
                  arrow = '▲';
                  changeColor = '#16a34a';
                } else if (delta < 0) {
                  arrow = '▼';
                  changeColor = '#dc2626';
                }
                changeText = `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
              }
              return (
                <View style={styles.momentumValueWrap}>
                  <Text style={styles.momentumValueMain}>{currentVal.toFixed(0)}</Text>
                  <View style={styles.momentumChangeRow}>
                    <Text style={[styles.momentumChange, { color: changeColor }]}>{arrow} {changeText}</Text>
                  </View>
                </View>
              );
            })()
          ) : (
            <Text style={styles.muted}>No rep momentum recorded yet.</Text>
          )}
        </View>

        <View style={styles.weightRow}>
          <Text style={styles.sectionLabel}>Weight Lifted</Text>
          <Text style={styles.weightValue}>{weight.toFixed(1)} lbs</Text>
          <View style={styles.loadGrid}>
            {LOAD_OPTIONS.map((amount) => (
              <View style={styles.loadRow} key={amount}>
                <TouchableOpacity
                  style={styles.loadButton}
                  onPress={() => adjustWeight(-amount)}
                >
                  <Text style={styles.loadButtonText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.loadValue}>{amount} lbs</Text>
                <TouchableOpacity style={styles.loadButton} onPress={() => adjustWeight(amount)}>
                  <Text style={styles.loadButtonText}>+</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>

        {showManualTargets && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Max TUT (s)</Text>
              <View style={styles.chipRow}>
                {tutOptions.map((opt, idx) => (
                  <Pressable
                    key={opt.label}
                    onPress={() => setTutLevel(idx)}
                    style={[styles.chip, tutLevel === idx && styles.chipSelected]}
                  >
                    <Text style={{ color: tutLevel === idx ? '#fff' : '#333' }}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Max Velocity (m/s)</Text>
              <View style={styles.chipRow}>
                {velOptions.map((opt, idx) => (
                  <Pressable
                    key={opt.label}
                    onPress={() => setVelLevel(idx)}
                    style={[styles.chip, velLevel === idx && styles.chipSelected]}
                  >
                    <Text style={{ color: velLevel === idx ? '#fff' : '#333' }}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </>
        )}

        {/* <View style={styles.metricsRow}>
          {Object.entries(feedback).map(([label, value]) => (
            <View key={label} style={styles.metric}>
              <Text style={styles.metricLabel}>{label}</Text>
              <Text style={styles.metricValue}>{value}</Text>
            </View>
          ))}
        </View> */}


        {connectedDevice && (
          <>
            {/* <TextInput
              style={styles.cmdInput}
              placeholder="Command e.g. 4,6"
              value={inputValue}
              onChangeText={setInputValue}
              returnKeyType="send"
              onSubmitEditing={() => sendCommand()}
            /> */}
            {/* <Button title="Send Command" onPress={() => sendCommand()} /> */}
            <View style={{ marginTop: 12 }}>
              <Button title="End Workout" color="#FF4136" onPress={() => sendCommand('5,0')} />
            </View>
          </>
        )}

      </View>
    );
  };

  const SummaryTable = () => {
    const grouped = rows.reduce((acc, row) => {
      const workout = row.workout || 'Unknown';
      const setNo = row.setNo && String(row.setNo).trim() !== '' ? String(row.setNo).trim() : '1';
      const key = `${workout}||${setNo}`;
      if (!acc[key]) acc[key] = { workout, setNo, items: [] };
      acc[key].items.push(row);
      return acc;
    }, {});

    const lines = [];
    Object.values(grouped).forEach((group) => {
      group.items.forEach((row, idx) => {
        lines.push({
          workout: group.workout,
          setNo: group.setNo,
          repNo: idx + 1,
          weight: row.weight || '0',
        });
      });
    });

    return (
      <View style={styles.summaryCard}>
        <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 10 }}>Perform Workout</Text>
        <View style={{ flexDirection: 'row', marginBottom: 6 }}>
          <Text style={styles.th}>Workout</Text>
          <Text style={styles.th}>Set #</Text>
          <Text style={styles.th}>Rep #</Text>
          <Text style={styles.th}>Weight</Text>
        </View>
        <FlatList
          data={lines}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => (
            <View style={{ flexDirection: 'row', paddingVertical: 6 }}>
              <Text style={styles.td}>{item.workout}</Text>
              <Text style={styles.td}>{item.setNo}</Text>
              <Text style={styles.td}>{item.repNo}</Text>
              <Text style={styles.td}>{item.weight}</Text>
            </View>
          )}
        />
        <Button title="Close" onPress={() => setShowSummary(false)} />
      </View>
    );
  };
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={64}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 200 }}>
        {renderHeader()}
        <View style={{ marginTop: 16 }}>
          <Button title="Complete Workout" onPress={() => setShowSummary(true)} />
        </View>
      </ScrollView>

      <Modal visible={infoModal.visible} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.infoContainer}>
            <Text style={styles.infoTitle}>{infoModal.title}</Text>
            <Text style={styles.infoText}>{infoModal.text}</Text>
            <Button title="Close" onPress={() => setInfoModal({ visible: false, title: '', text: '' })} />
          </View>
        </View>
      </Modal>

      <Modal visible={showSummary} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.summaryContainer}>
            <ScrollView contentContainerStyle={styles.summaryScroll}>
              <SummaryTable />
            </ScrollView>
            <View style={styles.summaryActions}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Button
                  title={savingWorkout ? 'Saving...' : 'Save Workout'}
                  onPress={handleSaveWorkout}
                  disabled={savingWorkout}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Close" onPress={() => setShowSummary(false)} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={readyModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeReadyModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Get Ready</Text>
            <Text style={{ textAlign: 'center', marginBottom: 20 }}>
              Get into a ready position and prepare to perform {pendingWorkout || selectedWorkout}.
            </Text>
            <Button title="Start" onPress={startWorkoutCommand} />
            <View style={{ height: 8 }} />
            <Button title="Cancel" color="#666" onPress={closeReadyModal} />
          </View>
        </View>
      </Modal>

      <Modal
        visible={summaryModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setSummaryModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Workout Summary</Text>
            {summary && (
              <>
                <IntensityBars
                  data={[
                    {
                      title: 'Velocity',
                      value: Math.round((summary.Velocity / maxVelocity) * 100),
                      display: summary.Velocity,
                      threshold70: true,
                      decimals: 2,
                    },
                    {
                      title: 'ROM',
                      value: Math.round((summary.ROM / maxRom) * 100),
                      display: summary.ROM,
                      rom: true,
                      decimals: 0,
                    },
                    {
                      title: 'TUT',
                      value: Math.round((summary.TUT / maxTUT) * 100),
                      display: summary.TUT,
                      threshold70: true,
                      decimals: 2,
                    },
                    { title: 'Score', value: summary.Score, display: summary.Score, decimals: 0 },
                  ]}
                  onInfo={handleInfo}
                />
                {[
                  ['Sets', summary.SetNumber],
                  ['Reps', summary.RepsCompleted],
                  ['Velocity', summary.Velocity.toFixed(2)],
                  ['ROM', Math.round(summary.ROM)],
                  ['TUT', summary.TUT.toFixed(2)],
                  ['Momentum', Math.round(summary.Momentum)],
                  ['Score', Math.round(summary.Score)],
                ].map(([label, value]) => (
                  <View style={styles.statRow} key={label}>
                    <Text>{label}</Text>
                    <Text style={styles.statValue}>{value}</Text>
                  </View>
                ))}
                <Button title="Close" onPress={() => setSummaryModalVisible(false)} />
              </>
            )}
          </View>
        </View>
      </Modal>

        <Modal visible={showDeviceModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>
                {deviceSlotToConnect === 'secondary'
                  ? 'Select a Secondary Device to Connect'
                  : 'Select a Device to Connect'}
              </Text>
              {connecting ? (
                <Text style={{ marginBottom: 16 }}>Scanning for nearby Bluetooth devices...</Text>
              ) : scannedDevices.length === 0 ? (
                <Text style={{ marginBottom: 16 }}>No devices found. Try scanning again.</Text>
              ) : null}
              <FlatList
                style={{ maxHeight: 200, width: '100%' }}
                data={scannedDevices}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => handleDeviceSelect(item)}
                    style={{ padding: 14 }}
                  >
                    <Text style={{ fontSize: 17 }}>{item.name || 'Unnamed device'}</Text>
                    <Text style={{ fontSize: 12, color: '#666' }}>{item.id}</Text>
                  </TouchableOpacity>
                )}
              />
              <Button
                title="Cancel"
                onPress={() => {
                  bleManager.stopDeviceScan();
                  setShowDeviceModal(false);
                  setConnecting(false);
                }}
              />
            </View>
          </View>
        </Modal>
    </KeyboardAvoidingView>
  );
}

// Info modal
// Placed after component for clarity (React Native allows returning fragment elements)
// Styles defined in StyleSheet below.


const styles = StyleSheet.create({
  listHeader: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 12,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionLabel: {
    fontWeight: '600',
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#f1f1f1',
  },
  chipSelected: {
    backgroundColor: '#007AFF',
  },
  sensorButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 150,
    alignItems: 'center',
  },
  sensorButtonDanger: {
    backgroundColor: '#1d4ed8',
  },
  sensorButtonDisabled: {
    backgroundColor: '#bfdbfe',
  },
  sensorButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  sensorButtonTextDisabled: {
    color: '#1d4ed8',
  },
  chartWrap: {
    alignItems: 'center',
    marginVertical: 16,
    width: '100%',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  barTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoIconWrap: {
    paddingHorizontal: 4,
  },
  infoIcon: {
    fontSize: 14,
  },
  barLabel: {
    width: 90,
    fontSize: 15,
    color: '#334155',
    fontWeight: '600',
  },
  barTrack: {
    flex: 1,
    height: 14,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 10,
  },
  barValue: {
    width: 60,
    fontSize: 14,
    color: '#334155',
    textAlign: 'right',
    fontWeight: '600',
  },
  repSetRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  repSetBox: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  repSetLabel: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 4,
  },
  repSetValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  momentumBars: {
    gap: 6,
    marginTop: 6,
  },
  momentumBarRow: {
    width: '100%',
  },
  momentumBarTrack: {
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    height: 18,
    justifyContent: 'center',
  },
  momentumBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#2563eb',
    borderRadius: 10,
  },
  momentumValueWrap: {
    alignItems: 'center',
    marginTop: 4,
  },
  momentumValueMain: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
  },
  momentumChangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  momentumChange: {
    fontSize: 14,
    fontWeight: '700',
  },
  weightRow: {
    marginBottom: 16,
  },
  weightValue: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },
  loadGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  loadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#fafafa',
  },
  loadButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#007AFF',
  },
  loadButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  loadValue: {
    marginHorizontal: 12,
    fontSize: 16,
    fontWeight: '600',
  },
  section: {
    marginBottom: 16,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#eee',
    paddingVertical: 12,
    marginBottom: 12,
  },
  metric: {
    width: '50%',
    paddingVertical: 4,
  },
  metricLabel: {
    fontSize: 12,
    color: '#666',
  },
  metricValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  cmdInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
    marginBottom: 8,
  },
  card: {
    marginBottom: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
  },
  select: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#fafafa',
  },
  dropdown: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
    marginTop: 4,
  },
  option: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoContainer: {
    width: '80%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  infoText: {
    fontSize: 14,
    color: '#334155',
    marginBottom: 8,
  },
  th: {
    flex: 1,
    fontWeight: '700',
  },
  td: {
    flex: 1,
  },
  summaryCard: {
    backgroundColor: 'white',
    margin: 20,
    borderRadius: 12,
    padding: 16,
  },
  planCard: {
    marginTop: 12,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#eef2ff',
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
    color: '#312e81',
  },
  planRow: {
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderColor: '#c7d2fe',
  },
  planRowTitle: {
    fontWeight: '600',
    color: '#1e1b4b',
  },
  planRowMeta: {
    fontSize: 12,
    color: '#4338ca',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  summaryContainer: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: 16,
    paddingVertical: 16,
    maxHeight: '85%',
  },
  summaryScroll: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  summaryActions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: 4,
  },
  statValue: {
    fontWeight: 'bold',
  },
});
