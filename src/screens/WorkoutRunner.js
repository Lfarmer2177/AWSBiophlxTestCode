
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Button,
  Dimensions,
  FlatList,
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

const WORKOUT_OPTIONS = ['Squat', 'Bench', 'Deadlift', 'Shoulder Press', 'DB Rows'];
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

export default function WorkoutRunner({ route }) {
  const [rows, setRows] = useState([]);
  const [openPickerId, setOpenPickerId] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [selectedWorkout, setSelectedWorkout] = useState(WORKOUT_OPTIONS[0]);
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);

  const [connectedDevice, setConDev] = useState(null);
  const [feedback, setFeedback] = useState({
    ROM: 0,
    TUT: 0,
    Velocity: 0,
    Score: 0,
    'Current Position': 0,
    reps: 0,
    sets: 0,
  });
  const [tutLevel, setTutLevel] = useState(0);
  const [velLevel, setVelLevel] = useState(0);
  const [weight, setWeight] = useState(0);
  const [repSnapshots, setRepSnapshots] = useState([]);
  const [velocityArray, setVelocityArray] = useState([]);
  const [forceArray, setForceArray] = useState([]);
  const [summary, setSummary] = useState(null);
  const [summaryModalVisible, setSummaryModalVisible] = useState(false);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [scannedDevices, setScannedDevices] = useState([]);
  const [connecting, setConnecting] = useState(false);
  const [bleState, setBleState] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [maxRom, setMaxRom] = useState(120);
  const prevRepsRef = useRef(0);
  const prevSetsRef = useRef(0);
  const weightRef = useRef(0);
  const workoutRef = useRef(WORKOUT_OPTIONS[0]);
  const feedbackRef = useRef(feedback);
  const permissionTimeoutRef = useRef(null);

  const maxTUT = tutOptions[tutLevel]?.value || 1;
  const maxVelocity = velOptions[velLevel]?.value || 1;

  const average = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  useEffect(() => {
    feedbackRef.current = feedback;
  }, [feedback]);

  useEffect(() => {
    weightRef.current = weight;
  }, [weight]);

  useEffect(() => {
    workoutRef.current = selectedWorkout;
  }, [selectedWorkout]);

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

  const disconnect = async () => {
    if (!connectedDevice) return;
    try {
      ['ROM', 'TUT', 'Velocity', 'Current Position', 'reps', 'sets'].forEach((label) => {
        try {
          bleManager.cancelTransaction(`workoutstream-${label}`);
        } catch {}
      });
      await bleManager.cancelDeviceConnection(connectedDevice.id);
    } catch (e) {
      console.warn('Disconnect error', e?.message || e);
    } finally {
      setConDev(null);
    }
  };

  const scanAndConnect = () => {
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

  const connectDevice = async (device) => {
    try {
      setConnecting(true);
      const connected = await device.connect();
      const ready = await connected.discoverAllServicesAndCharacteristics();
      bleManager.onDeviceDisconnected(ready.id, () => {
        console.log('Device disconnected');
        setConDev(null);
      });
      setConDev(ready);
      monitor(ready);
      await readCurrentPosition(ready);
      Alert.alert('Connected', `Connected to ${device.name || 'device'}`);
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
    connectDevice(device);
  };

  const monitor = (device) => {
    const watch = (svc, chr, label, fmt) => {
      const transactionId = `workoutstream-${label}`;
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
          setFeedback((prev) => {
            const next = { ...prev };
            if (label === 'Velocity') next.Velocity = +((value / 1000).toFixed(2));
            if (label === 'TUT') next.TUT = +((value / 1000).toFixed(2));
            if (label === 'ROM') next.ROM = value;
            if (label === 'Current Position') next['Current Position'] = value;
            if (label === 'reps') next.reps = value;
            if (label === 'sets') next.sets = value;
            if (label === 'ROM') next.Score = value > 120 ? 100 : value > 90 ? 50 : 0;
            return next;
          });
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

  const sendCommand = async (custom = null) => {
    if (!connectedDevice) {
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
      await connectedDevice.writeCharacteristicWithResponseForService(
        SERVICE_UUIDS.command,
        CHARACTERISTICS.command,
        payload
      );
    } catch {
      await connectedDevice.writeCharacteristicWithoutResponseForService(
        SERVICE_UUIDS.command,
        CHARACTERISTICS.command,
        payload
      );
    }

    readCurrentPosition();
    Keyboard.dismiss();
  };
  useEffect(() => {
    const reps = feedback.reps;
    if (reps > prevRepsRef.current) {
      const latest = feedbackRef.current;
      const vel = +(+latest.Velocity || 0).toFixed(2);
      const momentum = +(vel * weightRef.current).toFixed(2);
      const snapshot = {
        repIndex: reps,
        ROM: latest.ROM,
        TUT: +(+latest.TUT || 0).toFixed(2),
        Velocity: vel,
        Score: latest.Score,
        Momentum: momentum,
        setNo: latest.sets || 1,
      };
      setRepSnapshots((prev) => [...prev, snapshot]);
      setVelocityArray((prev) => [...prev, vel]);
      setForceArray((prev) => [...prev, momentum]);
      setRows((prev) => [
        ...prev,
        {
          id: uuidv4(),
          workout: workoutRef.current,
          setNo: String(latest.sets || 1),
          weight: String(weightRef.current || 0),
          score: String(latest.Score || 0),
          rom: String(latest.ROM || 0),
          tut: snapshot.TUT.toString(),
          velocity: vel.toFixed(2),
          momentum: momentum.toFixed(2),
        },
      ]);
      prevRepsRef.current = reps;
    }
  }, [feedback.reps]);

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
      setSummary(summaryObj);
      setSummaryModalVisible(true);
      setRepSnapshots([]);
      prevSetsRef.current = sets;
      prevRepsRef.current = 0;
    }
  }, [feedback.sets, repSnapshots]);

  const addManualRep = () => {
    setRows((prev) => [
      ...prev,
      {
        id: uuidv4(),
        workout: selectedWorkout,
        setNo: String(Math.max(1, feedback.sets || 1)),
        weight: String(weight),
        score: '',
        rom: '',
        tut: '',
        velocity: '',
        momentum: '',
      },
    ]);
  };

  const updateRow = (id, key, value) => {
    setRows((prev) => prev.map((item) => (item.id === id ? { ...item, [key]: value } : item)));
  };

  const toInt = (value) => {
    const n = typeof value === 'string' ? parseFloat(value) : Number(value);
    return Number.isFinite(n) ? Math.round(n) : 0;
  };

  const CREATE_SESSION = /* GraphQL */ `
    mutation CreateSession($input: CreateSessionInput!) {
      createSession(input: $input) {
        session_id
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

  const saveSession = async () => {
    if (!rows.length) {
      Alert.alert('No data', 'No reps recorded yet.');
      return;
    }
    try {
      const customer_id = route?.params?.customer_id;
      if (!customer_id) {
        Alert.alert('Missing customer', 'No customer_id provided in navigation params.');
        return;
      }
      const session_id = uuidv4();
      const now = new Date().toISOString();

      await client.graphql({
        query: CREATE_SESSION,
        variables: { input: { session_id, customer_id, workout_date: now } },
      });

      const groups = {};
      const order = [];
      rows.forEach((row) => {
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
      order.forEach((key, gi) => {
        const [workout, setNoStr] = key.split('||');
        const session_item_index = gi + 1;
        const setIndex = parseInt(setNoStr, 10) || 1;
        groups[key].forEach((row, repIdx) => {
          const session_item_rep_index = repIdx + 1;
          const rom = toInt(row.rom);
          const score = toInt(row.score);
          const tut = Number.parseFloat(row.tut) || 0;
          const velocity = Number.parseFloat(row.velocity) || 0;
          const momentum = Number.parseFloat(row.momentum) || 0;
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
      });

      await Promise.all(promises);
      Alert.alert('Saved', 'Session saved successfully.');
      setShowSummary(false);
    } catch (e) {
      console.log('Save session failed:', e);
      Alert.alert('Error', 'Failed to save the session. See console logs.');
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
            {WORKOUT_OPTIONS.map((opt) => (
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

      <TextInput
        placeholder="Set #"
        keyboardType="numeric"
        value={item.setNo}
        onChangeText={(v) => updateRow(item.id, 'setNo', v)}
        style={styles.input}
      />
      <TextInput
        placeholder="Weight"
        keyboardType="numeric"
        value={item.weight}
        onChangeText={(v) => updateRow(item.id, 'weight', v)}
        style={styles.input}
      />
      <TextInput
        placeholder="Score"
        keyboardType="numeric"
        value={item.score}
        onChangeText={(v) => updateRow(item.id, 'score', v)}
        style={styles.input}
      />
      <TextInput
        placeholder="ROM"
        keyboardType="numeric"
        value={item.rom}
        onChangeText={(v) => updateRow(item.id, 'rom', v)}
        style={styles.input}
      />
      <TextInput
        placeholder="TUT"
        keyboardType="numeric"
        value={item.tut}
        onChangeText={(v) => updateRow(item.id, 'tut', v)}
        style={styles.input}
      />
      <TextInput
        placeholder="Velocity"
        keyboardType="numeric"
        value={item.velocity}
        onChangeText={(v) => updateRow(item.id, 'velocity', v)}
        style={styles.input}
      />
      <TextInput
        placeholder="Momentum"
        keyboardType="numeric"
        value={item.momentum}
        onChangeText={(v) => updateRow(item.id, 'momentum', v)}
        style={styles.input}
      />
    </View>
  );

  const renderHeader = () => {
    const chartData = [
      { title: 'Velocity', value: Math.round((feedback.Velocity / maxVelocity) * 100) },
      { title: 'ROM', value: Math.round((feedback.ROM / maxRom) * 100) },
      { title: 'TUT', value: Math.round((feedback.TUT / maxTUT) * 100) },
      { title: 'Score', value: feedback.Score },
    ].map((item) => ({
      ...item,
      value: Number.isFinite(item.value) ? item.value : 0,
    }));
    const maxAxis = Math.max(100, ...chartData.map((d) => d.value));

    return (
      <View style={styles.listHeader}>
        <Text style={styles.header}>Workout Runner</Text>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>
            Device: {connectedDevice ? connectedDevice.name || connectedDevice.id : 'Not connected'}
          </Text>
          {connectedDevice ? (
            <Button title="Disconnect" color="#d33" onPress={disconnect} />
          ) : (
            <Button title="Scan & Connect" onPress={scanAndConnect} />
          )}
        </View>

        <View style={styles.chipRow}>
          {WORKOUT_OPTIONS.map((opt) => (
            <Pressable
              key={opt}
              onPress={() => setSelectedWorkout(opt)}
              style={[styles.chip, selectedWorkout === opt && styles.chipSelected]}
            >
              <Text style={{ color: selectedWorkout === opt ? '#fff' : '#333' }}>{opt}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.chartWrap}>
          <SvgRadarChart size={screenWidth * 0.7} max={maxAxis} data={chartData} />
        </View>

        <View style={styles.weightRow}>
          <Text style={styles.sectionLabel}>Load (lbs)</Text>
          <View style={styles.weightControls}>
            {[-10, -5, -1, 1, 5, 10].map((delta) => (
              <TouchableOpacity
                key={delta}
                style={styles.weightButton}
                onPress={() => setWeight((prev) => Math.max(0, prev + delta))}
              >
                <Text>{delta > 0 ? `+${delta}` : delta}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={String(weight)}
            keyboardType="numeric"
            onChangeText={(v) => setWeight(Number.parseInt(v, 10) || 0)}
          />
        </View>

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

        <View style={styles.metricsRow}>
          {Object.entries(feedback).map(([label, value]) => (
            <View key={label} style={styles.metric}>
              <Text style={styles.metricLabel}>{label}</Text>
              <Text style={styles.metricValue}>{value}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>
          Velocity: [{velocityArray.map((v) => v.toFixed(2)).join(', ')}]
        </Text>
        <Text style={styles.sectionLabel}>
          Force: [{forceArray.map((f) => f.toFixed(2)).join(', ')}]
        </Text>

        {connectedDevice && (
          <>
            <TextInput
              style={styles.cmdInput}
              placeholder="Command e.g. 4,6"
              value={inputValue}
              onChangeText={setInputValue}
              returnKeyType="send"
              onSubmitEditing={() => sendCommand()}
            />
            <Button title="Send Command" onPress={() => sendCommand()} />
            <View style={{ marginTop: 12 }}>
              <Button title="End Workout" color="#FF4136" onPress={() => sendCommand('5,0')} />
            </View>
          </>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Recorded Reps</Text>
          <Text style={{ color: '#666' }}>
            Incoming reps from BLE are appended automatically. You can still edit or add manual
            entries below.
          </Text>
        </View>
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
        <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 10 }}>Workout Summary</Text>
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
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 200 }}
        renderItem={renderRow}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: '#555', marginVertical: 16 }}>
            No reps recorded yet.
          </Text>
        }
        ListFooterComponent={
          <View style={{ marginTop: 16, rowGap: 12 }}>
            <Button title="Add Manual Rep" onPress={addManualRep} />
            <Button title="Complete Workout" onPress={() => setShowSummary(true)} />
          </View>
        }
      />

      <Modal visible={showSummary} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View>
            <SummaryTable />
            <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 20 }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Button title="Save Session" onPress={saveSession} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Close" onPress={() => setShowSummary(false)} />
              </View>
            </View>
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
                <SvgRadarChart
                  size={screenWidth * 0.6}
                  max={100}
                  data={[
                    { title: 'Velocity', value: Math.round((summary.Velocity / maxVelocity) * 100) },
                    { title: 'ROM', value: Math.round((summary.ROM / maxRom) * 100) },
                    { title: 'TUT', value: Math.round((summary.TUT / maxTUT) * 100) },
                    { title: 'Score', value: summary.Score },
                  ]}
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
              <Text style={styles.modalTitle}>Select a Device to Connect</Text>
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
  chartWrap: {
    alignItems: 'center',
    marginVertical: 16,
  },
  weightRow: {
    marginBottom: 16,
  },
  weightControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  weightButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
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
