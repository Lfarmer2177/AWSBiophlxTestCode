// BLE UUIDs matching ESP32 firmware.
export const BleUuids = {
  deviceNamePrefix: 'bplx-',

  batteryService: '180F',
  batteryLevel: '2A19',

  deviceStatusService: 'eae2f5f4-b18f-4f4d-0001-100000000000',
  currentPosition: 'eae2f5f4-b18f-4f4d-0001-100000000001',
  rangeOfMotion: 'eae2f5f4-b18f-4f4d-0001-100000000002',
  timeUnderTension: 'eae2f5f4-b18f-4f4d-0001-100000000003',
  repsCompleted: 'eae2f5f4-b18f-4f4d-0001-100000000004',
  acceleration: 'eae2f5f4-b18f-4f4d-0001-100000000005',
  setComplete: 'eae2f5f4-b18f-4f4d-0001-100000000006',
  exerciseStage: 'eae2f5f4-b18f-4f4d-0001-100000000007',
  rawSensorData: 'eae2f5f4-b18f-4f4d-0001-100000000008',

  deviceCommandService: 'eae2f5f4-b18f-4f4d-0002-100000000000',
  command: 'eae2f5f4-b18f-4f4d-0002-100000000001',
  returnCode: 'eae2f5f4-b18f-4f4d-0002-100000000002',

  otaService: 'eae2f5f4-b18f-4f4d-0003-100000000000',
  otaVersion: 'eae2f5f4-b18f-4f4d-0003-100000000001',
};

export const DeviceCommands = {
  nop: 0,
  id: 1,
  off: 2,
  restart: 3,
  start: 4,
  stop: 5,
  tare: 6,
  setBleSet: 7,
  calibrateBattery: 8,
  rawSensorStream: 9,
};

export const TareFunctions = {
  clear: 0,
  perform: 1,
  save: 2,
};

export const ExerciseType = {
  barbellBench: { value: 0, displayName: 'Barbell Bench' },
  benchDips: { value: 1, displayName: 'Bench Dips' },
  lateralRaise: { value: 2, displayName: 'Lateral Raise' },
  dumbellRow: { value: 3, displayName: 'Dumbell Row' },
  overheadPress: { value: 4, displayName: 'Overhead Press' },
  pushUp: { value: 5, displayName: 'Push Up' },
  airSquat: { value: 6, displayName: 'Air Squat' },
  barbellDeadlift: { value: 7, displayName: 'Barbell Deadlift' },
  barbellSquat: { value: 8, displayName: 'Barbell Squat' },
  dumbellLunge: { value: 9, displayName: 'Dumbell Lunge' },
  layingLegRaise: { value: 10, displayName: 'Laying Leg Raise' },
  mountainClimbers: { value: 11, displayName: 'Mountain Climbers' },
  squatAndPressUpper: { value: 12, displayName: 'Squat & Press (Upper)' },
  squatAndPressLower: { value: 13, displayName: 'Squat & Press (Lower)' },
  freeDefinition: { value: 255, displayName: 'Free Definition' },
};

export function exerciseTypeFromValue(value) {
  const key = Object.keys(ExerciseType).find((k) => ExerciseType[k].value === value);
  return key || 'freeDefinition';
}

export const ExerciseLimb = {
  arm: { value: 0, displayName: 'Arm' },
  leg: { value: 1, displayName: 'Leg' },
  undefined: { value: 255, displayName: 'Undefined' },
};

export const ExerciseSide = {
  left: { value: 0, displayName: 'Left' },
  right: { value: 1, displayName: 'Right' },
  both: { value: 255, displayName: 'Both' },
};

export const ExerciseStage = {
  none: { value: 0, displayName: 'None' },
  waitingForIdle: { value: 1, displayName: 'Waiting for Idle' },
  idle: { value: 2, displayName: 'Idle' },
  extending: { value: 3, displayName: 'Extending' },
  retracting: { value: 4, displayName: 'Retracting' },
  any: { value: 255, displayName: 'Any' },
};

export function exerciseStageFromValue(value) {
  const key = Object.keys(ExerciseStage).find((k) => ExerciseStage[k].value === value);
  return key || 'none';
}

export const ReturnCodes = {
  nothing: 0,
  success: 1,
  running: 255,

  errBase: 128,
  errBleServer: 129,
  errActionType: 130,
  errFsInit: 131,
  errSnsInit: 132,
  errBleAdv: 133,
  errCmdInvalid: 137,
  errBattery: 138,
  errCmdParams: 140,
  errOthMemory: 142,
  errBleMtu: 144,
  errSnsModel: 145,
};

export function getReturnCodeName(code) {
  switch (code) {
    case ReturnCodes.nothing:
      return 'NOTHING';
    case ReturnCodes.success:
      return 'SUCCESS';
    case ReturnCodes.running:
      return 'RUNNING';
    case ReturnCodes.errBleServer:
      return 'BLE_SERVER_ERROR';
    case ReturnCodes.errActionType:
      return 'INVALID_ACTION_TYPE';
    case ReturnCodes.errFsInit:
      return 'FILESYSTEM_INIT_ERROR';
    case ReturnCodes.errSnsInit:
      return 'SENSOR_INIT_ERROR';
    case ReturnCodes.errBleAdv:
      return 'BLE_ADVERTISING_ERROR';
    case ReturnCodes.errCmdInvalid:
      return 'INVALID_COMMAND';
    case ReturnCodes.errBattery:
      return 'INSUFFICIENT_BATTERY';
    case ReturnCodes.errCmdParams:
      return 'INVALID_PARAMS';
    case ReturnCodes.errOthMemory:
      return 'OUT_OF_MEMORY';
    case ReturnCodes.errBleMtu:
      return 'BLE_MTU_ERROR';
    case ReturnCodes.errSnsModel:
      return 'INVALID_SENSOR_MODEL';
    default:
      return `UNKNOWN (${code})`;
  }
}

const toLegacyArray = (obj) =>
  Object.values(obj).map((item) => ({
    value: item.value,
    name: item.displayName,
    displayName: item.displayName,
  }));

export const EXERCISE_TYPES = toLegacyArray(ExerciseType);
export const EXERCISE_LIMBS = toLegacyArray(ExerciseLimb);
export const EXERCISE_SIDES = toLegacyArray(ExerciseSide);

export const BLE_CONSTANTS = {
  DEVICE_NAME_PREFIX: BleUuids.deviceNamePrefix,
  SCAN_TIMEOUT: 10000,

  BATTERY_SERVICE_UUID: BleUuids.batteryService,
  BATTERY_LEVEL_CHAR_UUID: BleUuids.batteryLevel,

  DEVICE_STATUS_SERVICE_UUID: BleUuids.deviceStatusService,
  RAW_SENSOR_DATA_CHAR_UUID: BleUuids.rawSensorData,

  DEVICE_COMMAND_SERVICE_UUID: BleUuids.deviceCommandService,
  DEVICE_COMMAND_CHAR_UUID: BleUuids.command,

  TARE_FUNCTIONS: {
    CLEAR: TareFunctions.clear,
    PERFORM: TareFunctions.perform,
    SAVE: TareFunctions.save,
  },

  COMMANDS: {
    ON: DeviceCommands.id,
    NOP: DeviceCommands.nop,
    ID: DeviceCommands.id,
    OFF: DeviceCommands.off,
    RESTART: DeviceCommands.restart,
    START: DeviceCommands.start,
    STOP: DeviceCommands.stop,
    ACCEL_TARE: DeviceCommands.tare,
    RAW_STREAM: DeviceCommands.rawSensorStream,
  },
};

function toByte(value, fallback = 0) {
  const n = Number.isFinite(value) ? Number(value) : fallback;
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return n & 0xff;
}

export function createCommand(commandCode, payload = {}) {
  if (typeof payload === 'number') {
    return Uint8Array.from([toByte(commandCode), toByte(payload), 0, 0]);
  }

  const p = payload || {};
  const byte1 = p.byte1 ?? p.extype ?? p.exerciseType ?? p.interval ?? 0;
  const byte2 = p.byte2 ?? p.limb ?? p.delay ?? 0;
  const byte3 = p.byte3 ?? p.side ?? p.unused ?? 0;

  return Uint8Array.from([
    toByte(commandCode),
    toByte(byte1),
    toByte(byte2),
    toByte(byte3),
  ]);
}

function base64ToBytes(b64) {
  if (!b64 || typeof b64 !== 'string') return null;

  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(b64, 'base64'));
  }

  try {
    const { decode } = require('react-native-base64');
    const binary = decode(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

export function parseSensorData(base64Value) {
  const bytes = base64ToBytes(base64Value);
  if (!bytes || bytes.length < 28) return null;

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const decodeMderFloat32 = (offset) => {
    const raw = dv.getUint32(offset, true);
    const exponent = (raw << 0) >> 24;
    let mantissa = raw & 0x00ffffff;
    if (mantissa & 0x00800000) {
      mantissa |= 0xff000000;
    }
    return mantissa * Math.pow(10, exponent);
  };

  const decodeIeeeFloat32 = (offset) => dv.getFloat32(offset, true);

  const buildSample = (decoder) => ({
    timestamp: dv.getUint32(0, true),
    roll: decoder(4),
    pitch: decoder(8),
    yaw: decoder(12),
    gyroX: decoder(16),
    gyroY: decoder(20),
    gyroZ: decoder(24),
  });

  const isPlausible = (sample) => {
    const values = [
      sample.roll,
      sample.pitch,
      sample.yaw,
      sample.gyroX,
      sample.gyroY,
      sample.gyroZ,
    ];
    if (values.some((v) => !Number.isFinite(v))) return false;

    const orientOk =
      Math.abs(sample.roll) <= 720 &&
      Math.abs(sample.pitch) <= 720 &&
      Math.abs(sample.yaw) <= 720;
    const gyroOk =
      Math.abs(sample.gyroX) <= 10000 &&
      Math.abs(sample.gyroY) <= 10000 &&
      Math.abs(sample.gyroZ) <= 10000;

    return orientOk && gyroOk;
  };

  const mderSample = buildSample(decodeMderFloat32);
  if (isPlausible(mderSample)) return mderSample;

  const ieeeSample = buildSample(decodeIeeeFloat32);
  if (isPlausible(ieeeSample)) return ieeeSample;

  return mderSample;
}
