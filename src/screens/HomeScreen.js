import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser, signOut } from 'aws-amplify/auth';
import { v4 as uuidv4 } from 'uuid';
import { FontAwesome5 } from '@expo/vector-icons';
import Body from '../Components/react-native-body-highlighter';
import Colors from '../Theme/Colors';
import {
  listSessionsByCustomerQuery,
  listSessionItemsBySession,
  listSessionItemRepsQuery,
  listSessionItemSetsQuery,
  listExercises,
  getExerciseQuery,
} from '../graphql/queries';

const LIST_CUSTOMERS_BY_USER = /* GraphQL */ `
  query ListCustomers($user_id: ID!) {
    listCustomers(filter: { user_id: { eq: $user_id } }, limit: 1) {
      items { customer_id }
      nextToken
    }
  }
`;

const GET_USER = /* GraphQL */ `
  query GetUser($user_id: ID!) {
    getUser(user_id: $user_id) {
      gender
      role
    }
  }
`;

const LIST_TRAINERS_BY_USER = /* GraphQL */ `
  query ListTrainers($user_id: ID!) {
    listTrainers(filter: { user_id: { eq: $user_id } }, limit: 1) {
      items { trainer_id user_id }
      nextToken
    }
  }
`;

const CREATE_CUSTOMER = /* GraphQL */ `
  mutation CreateCustomer($input: CreateCustomerInput!) {
    createCustomer(input: $input) { customer_id }
  }
`;

const actions = [
  { label: 'Run a Workout', key: 'runner', accent: true },
  { label: 'Build a Workout', key: 'builder' },
  { label: 'My Workouts', key: 'library' },
  { label: 'View Sessions', key: 'sessions' },
  { label: 'Exercise Library', key: 'exercises' },
  { label: 'Trainers', key: 'trainerDirectory' },
  { label: 'Edit Profile', key: 'profile' },
  // Trainer Dashboard will be injected dynamically when a trainer_id exists
];

const MAX_SESSION_ITEM_INDEX = 20;

const formatDate = (value) => {
  try {
    const d = value ? new Date(value) : new Date();
    return d.toISOString().split('T')[0];
  } catch {
    return '';
  }
};

const normalizeDate = (value) => {
  if (!value) return null;
  try {
    const d = new Date(value);
    return d.toISOString().split('T')[0];
  } catch {
    return null;
  }
};

const bodyParts = {
  trapezius: { muscleName: 'Traps', side: 'Both' },
  triceps: { muscleName: 'Triceps', side: 'Both' },
  forearm: { muscleName: 'Forearm', side: 'Both' },
  adductors: { muscleName: 'Adductors', side: 'Both' },
  calves: { muscleName: 'Calves', side: 'Both' },
  neck: { muscleName: 'Neck', side: 'Both' },
  deltoids: { muscleName: 'Deltoids', side: 'Both' },
  hands: { muscleName: 'Hands', side: 'Both' },
  feet: { muscleName: 'Feet', side: 'Both' },
  head: { muscleName: 'Head', side: 'Both' },
  ankles: { muscleName: 'Ankles', side: 'Both' },
  tibialis: { muscleName: 'Tibialis', side: 'Front' },
  obliques: { muscleName: 'Abs', side: 'Front' },
  chest: { muscleName: 'Chest', side: 'Front' },
  biceps: { muscleName: 'Biceps', side: 'Front' },
  abs: { muscleName: 'Abs', side: 'Front' },
  quadriceps: { muscleName: 'Quads', side: 'Front' },
  knees: { muscleName: 'Knees', side: 'Front' },
  'upper-back': { muscleName: 'Upper Back', side: 'Back' },
  'lower-back': { muscleName: 'Lower Back', side: 'Back' },
  hamstring: { muscleName: 'Hamstrings', side: 'Back' },
  gluteal: { muscleName: 'Glutes', side: 'Back' },
};

const unwrapString = (value) => {
  if (value?.S) return value.S;
  if (typeof value === 'string') {
    if (value.startsWith('{') && value.endsWith('}')) {
      const idx = value.indexOf('=');
      if (idx !== -1) {
        return value.substring(idx + 1, value.length - 1).trim();
      }
    }
    return value;
  }
  return value ?? '';
};

const toArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(unwrapString).filter(Boolean);
  if (typeof value === 'string') return [value];
  if (typeof value === 'object') {
    if (Array.isArray(value.SS)) return value.SS.map(unwrapString).filter(Boolean);
    if (value.S) return [value.S];
    return Object.values(value)
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry?.S) return entry.S;
        if (Array.isArray(entry?.SS)) return entry.SS;
        return null;
      })
      .flat()
      .map(unwrapString)
      .filter(Boolean);
  }
  return [];
};

const normalizeKey = (val) => {
  if (val === null || val === undefined) return '';
  const unwrapped = unwrapString(val);
  if (typeof unwrapped === 'string') return unwrapped.trim().toLowerCase();
  return String(unwrapped).trim().toLowerCase();
};

export default function HomeScreen({ navigation }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const [bodyData, setBodyData] = useState([]);
  const [loadSelectedDate, setLoadSelectedDate] = useState(formatDate(new Date()));
  const [totalMomentumData, setTotalMomentumData] = useState(0);
  const [workoutDetail, setWorkOutDetail] = useState([]);
  const [exerciseMap, setExerciseMap] = useState({});
  const [loadingBody, setLoadingBody] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);
  const [expandedSessionId, setExpandedSessionId] = useState(null);
  const [sessionDetailsMap, setSessionDetailsMap] = useState({});
  const [sessionLoadingMap, setSessionLoadingMap] = useState({});
  const [monthDate, setMonthDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [sessionMomentumMap, setSessionMomentumMap] = useState({});
  const [momentumByDate, setMomentumByDate] = useState({});
  const fetchedMomentumRef = React.useRef(new Set());
  const [muscleMomentumList, setMuscleMomentumList] = useState([]);
  const [range, setRange] = useState('month'); // 'week' | 'month' | 'year'
  const [trainerId, setTrainerId] = useState(null);
  const [userGender, setUserGender] = useState('male');
  const [userRole, setUserRole] = useState('');
  const handleRangeChange = (opt) => {
    setRange(opt);
    setSelectedDate(null);
    setLoadSelectedDate(formatDate(monthDate));
    buildMonthlyMuscleData(sessions, null, opt);
  };

  const asList = useCallback((value) => {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.items)) return value.items;
    return [];
  }, []);

  const getDateLabel = (inputDate) => {
    const startOfDay = (d) => {
      const copy = new Date(d);
      copy.setHours(0, 0, 0, 0);
      return copy;
    };
    const today = startOfDay(new Date());
    const date = startOfDay(inputDate);
    const msPerDay = 24 * 60 * 60 * 1000;
    const diff = Math.round((date - today) / msPerDay);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (Math.abs(diff) < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
    return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const getMuscleBoxColor = (percentage) => {
    if (percentage > 60) {
      return { backgroundColor: 'pink' };
    }
    if (percentage < 25) {
      return { backgroundColor: 'lightgreen' };
    }
    return { backgroundColor: '#FCE883' };
  };

  const findGreatestAndLowest = (muscles, valueToCheck) => {
    let greatest = { value: -Infinity, name: '' };
    let lowest = { value: Infinity, name: '' };
    Object.keys(muscles).forEach((key) => {
      const total = parseFloat(muscles[key].total);
      if (total > greatest.value) greatest = { value: total, name: muscles[key].muscleName };
      if (total < lowest.value) lowest = { value: total, name: muscles[key].muscleName };
    });
    const value = parseFloat(valueToCheck);
    if (value === greatest.value) return 'Greatest';
    if (value === lowest.value) return 'Lowest';
    return 'Middle';
  };

  const fetchExercises = async () => {
    if (Object.keys(exerciseMap).length) return exerciseMap;
    try {
      const { data } = await client.graphql({ query: listExercises, variables: { limit: 500 } });
      const exItems = asList(data?.listExercises);
      const map = {};
      exItems.forEach((ex) => {
        const norm = { ...ex };
        norm.exercise_id = unwrapString(ex?.exercise_id);
        norm.name = unwrapString(ex?.name);
        norm.muscle_group = toArray(ex?.muscle_group).map(unwrapString);
        const idKey = normalizeKey(norm?.exercise_id);
        const nameKey = normalizeKey(norm?.name);
        if (idKey) map[idKey] = norm;
        if (nameKey) map[nameKey] = norm;
      });
      console.log('Exercise map keys', Object.keys(map));
      setExerciseMap(map);
      return map;
    } catch (err) {
      console.log('Fetch exercises failed', err);
      return {};
    }
  };

  const fetchExerciseDetail = async (exerciseId) => {
    if (!exerciseId) return null;
    try {
      const { data } = await client.graphql({
        query: getExerciseQuery,
        variables: { exercise_id: exerciseId },
      });
      const ex = data?.getExercise || null;
      if (!ex) return null;
      const norm = {
        ...ex,
        exercise_id: unwrapString(ex.exercise_id),
        name: unwrapString(ex.name),
        muscle_group: toArray(ex.muscle_group).map(unwrapString),
      };
      setExerciseMap((prev) => {
        const next = { ...prev };
        const idKey = normalizeKey(norm.exercise_id);
        const nameKey = normalizeKey(norm.name);
        if (idKey) next[idKey] = norm;
        if (nameKey) next[nameKey] = norm;
        return next;
      });
      return norm;
    } catch (err) {
      console.log('Fetch exercise detail failed', exerciseId, err);
      return null;
    }
  };

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const custId = await resolveCustomerId();
      if (!custId) {
        setSessions([]);
        setSessionsLoading(false);
        return;
      }
      const { data } = await client.graphql({
        query: listSessionsByCustomerQuery,
        variables: { customer_id: custId, limit: 50 },
      });
      const list = asList(data?.listSessionsByCustomer);
      list.sort((a, b) => new Date(b.workout_date || b.created_at) - new Date(a.workout_date || a.created_at));
      setSessions(list);
      if (!selectedDate && list.length) {
        const recent = normalizeDate(list[0].workout_date || list[0].created_at);
        if (recent) {
          setSelectedDate(recent);
          setMonthDate(new Date(recent));
          setLoadSelectedDate(recent);
          buildMonthlyMuscleData(list, recent, range);
        }
      } else if (list.length) {
        buildMonthlyMuscleData(list, selectedDate, range);
      }
    } catch (err) {
      console.log('Fetch sessions failed', err);
      setSessionsError('Failed to load sessions.');
    } finally {
      setSessionsLoading(false);
    }
  }, [client, asList, normalizeDate, selectedDate, buildMonthlyMuscleData, range]);

  useEffect(() => {
    fetchSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Discover trainer_id to decide whether to show the Trainer dashboard entry
  useEffect(() => {
    (async () => {
      try {
        const current = await getCurrentUser();
        const user_id = current?.userId || current?.username;
        // Fetch user gender
        try {
          const { data } = await client.graphql({
            query: GET_USER,
            variables: { user_id },
          });
          const g = (data?.getUser?.gender || '').toLowerCase();
          if (g === 'female' || g === 'male') setUserGender(g);
          const r = (data?.getUser?.role || '').toLowerCase();
          setUserRole(r);
        } catch (e) {
          console.log('HomeScreen: Fetch user role failed', e);
        }

        // Even if role isn't 'trainer' yet in DB, we check if a trainer record exists
        const { data: tData } = await client.graphql({
          query: LIST_TRAINERS_BY_USER,
          variables: { user_id },
        });
        const trainer = tData?.listTrainers?.items?.[0];
        if (trainer?.trainer_id) {
          setTrainerId(trainer.trainer_id);
          console.log('HomeScreen: User has trainer_id:', trainer.trainer_id);
        } else {
          setTrainerId(null);
          console.log('HomeScreen: No trainer record found for user_id:', user_id);
        }
      } catch (err) {
        console.log('HomeScreen: Fetch trainer for dashboard failed', err);
      }
    })();
  }, [client]);

  const ensureTrainerId = useCallback(async () => {
    if ((userRole || '').toLowerCase() !== 'trainer') return null;
    if (trainerId) return trainerId;
    try {
      const current = await getCurrentUser();
      const user_id = current?.userId || current?.username;
      const { data: listData } = await client.graphql({
        query: LIST_TRAINERS_BY_USER,
        variables: { user_id },
      });
      const items = listData?.listTrainers?.items || [];
      const trainer = items.find(item => item.user_id === user_id);
      if (trainer?.trainer_id) {
        setTrainerId(trainer.trainer_id);
        console.log('Trainer ID (existing):', trainer.trainer_id);
        return trainer.trainer_id;
      }
    } catch (err) {
      console.log('ensureTrainerId failed', err);
    }
    return null;
  }, [client, trainerId, userRole]);

  const buildMonthlyMuscleData = useCallback(async (sessionOverride = null, selectedOverride = null, rangeOverride = null) => {
    setLoadingBody(true);
    try {
      const exMap = await fetchExercises();
      const currentRange = rangeOverride || range;
      const sessionList = sessionOverride || sessions;
      const selected = selectedOverride !== null ? selectedOverride : selectedDate;

      const anchorDateStr =
        selected ||
        (sessionList.length ? normalizeDate(sessionList[0].workout_date || sessionList[0].created_at) : null) ||
        formatDate(new Date());
      const anchor = new Date(anchorDateStr);
      const start = new Date(anchor);
      start.setHours(0, 0, 0, 0);
      let end = new Date(anchor);
      end.setHours(23, 59, 59, 999);
      if (currentRange === 'week') {
        start.setDate(start.getDate() - 6);
      } else if (currentRange === 'month') {
        start.setDate(1);
        end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);
      } else if (currentRange === 'year') {
        start.setMonth(0, 1);
        end = new Date(anchor.getFullYear(), 11, 31, 23, 59, 59, 999);
      }
      let targetSessions =
        selected && sessionList.length
          ? sessionList.filter((s) => normalizeDate(s.workout_date || s.created_at) === selected)
          : sessionList.filter((s) => {
              const dateStr = normalizeDate(s.workout_date || s.created_at);
              if (!dateStr) return false;
              const d = new Date(dateStr);
              return d >= start && d <= end;
            });
      if (!targetSessions.length && sessionList.length) {
        const sorted = [...sessionList].sort(
          (a, b) => new Date(b.workout_date || b.created_at) - new Date(a.workout_date || a.created_at)
        );
        targetSessions = [sorted[0]];
        const recent = normalizeDate(sorted[0].workout_date || sorted[0].created_at);
        if (recent) setSelectedDate(recent);
      }
      if (!targetSessions.length) {
        targetSessions = sessionList;
      }
      if (!targetSessions.length) {
        setBodyData([]);
        setTotalMomentumData(0);
        setMuscleMomentumList([]);
        return;
      }

      const muscleTotals = {};
      let totalMomentum = 0;

      for (const sess of targetSessions) {
        const { data: itemsData } = await client.graphql({
          query: listSessionItemsBySession,
          variables: { session_id: sess.session_id, limit: 100 },
        });
        const items = asList(itemsData?.listSessionItemsBySession);
        const itemByIndex = {};
        items.forEach((it) => {
          if (!it?.session_item_index) return;
          // Keep only items that belong to this session_id
          if (it.session_id && it.session_id !== sess.session_id) return;
          itemByIndex[it.session_item_index] = it;
        });

        const { data: repsData } = await client.graphql({
          query: listSessionItemRepsQuery,
          variables: { session_id: sess.session_id, limit: 1000 },
        });
        const reps = asList(repsData?.listSessionItemReps);

        for (const rep of reps) {
          if (rep?.session_id && rep.session_id !== sess.session_id) {
            continue;
          }
          const idx = rep.session_item_index;
          const parentItem = itemByIndex[idx];
          if (!parentItem) {
            console.log('No parent session item for rep', rep?.session_item_index, 'session', sess.session_id);
            continue;
          }
          const exerciseId = normalizeKey(parentItem?.exercise_id || rep?.exercise_id);
          console.log('Rep exerciseId', exerciseId, 'raw', parentItem?.exercise_id);
          let ex = exerciseId ? exerciseMap[exerciseId] || exMap[exerciseId] : null;
          if (!ex && exerciseId) {
            ex = Object.values(exMap).find((val) => {
              const exIdKey = normalizeKey(val?.exercise_id);
              const exNameKey = normalizeKey(val?.name);
              return (
                exIdKey === exerciseId ||
                exNameKey === exerciseId ||
                (exIdKey && exerciseId && (exIdKey.includes(exerciseId) || exerciseId.includes(exIdKey))) ||
                (exNameKey && exerciseId && (exNameKey.includes(exerciseId) || exerciseId.includes(exNameKey)))
              );
            });
          }
          if ((!ex || !Array.isArray(ex?.muscle_group) || !ex.muscle_group.length) && exerciseId) {
            // Pull full exercise detail to get muscle_group when list query didn't include it
            // eslint-disable-next-line no-await-in-loop
            const fetched = await fetchExerciseDetail(parentItem.exercise_id);
            if (fetched && (!ex || normalizeKey(fetched.exercise_id) === exerciseId)) {
              ex = fetched;
            }
          }
          if (!ex) {
            console.log('No exercise match for', exerciseId, 'muscle_focus', parentItem?.muscle_focus);
          } else {
            console.log('Exercise match', { exerciseId, name: ex?.name, mg: ex?.muscle_group });
            console.log(
              'Exercise muscle_group raw string',
              exerciseId,
              ex?.muscle_group ? JSON.stringify(ex.muscle_group) : null
            );
          }
          const mg = Array.isArray(ex?.muscle_group) ? ex.muscle_group : toArray(ex?.muscle_group);
          let parsed = mg
            .map((entry) => {
              let str = null;
              if (typeof entry === 'string') str = entry;
              else if (entry && typeof entry === 'object') {
                if (typeof entry.S === 'string') str = entry.S;
                else if (typeof entry.value === 'string') str = entry.value;
                else if (typeof entry.name === 'string') str = entry.name;
                else {
                  // Treat as a map of muscle -> weight
                  return Object.entries(entry).map(([k, v]) => {
                    let w = null;
                    if (typeof v === 'number') w = v;
                    else if (v && typeof v === 'object' && typeof v.N === 'string') w = parseFloat(v.N);
                    else if (typeof v === 'string') w = parseFloat(v);
                    return { name: k.trim(), weight: Number.isFinite(w) ? w : null };
                  });
                }
              }
              if (!str) return null;
              const trimmed = str.trim();
              if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                  const obj = JSON.parse(trimmed);
                  return Object.keys(obj).map((k) => ({
                    name: k.trim(),
                    weight: Number(obj[k]),
                  }));
                } catch {
                  // fall through
                }
              }
              const colonIdx = trimmed.indexOf(':');
              if (colonIdx !== -1) {
                const name = trimmed.slice(0, colonIdx).trim();
                const weightStr = trimmed.slice(colonIdx + 1).trim();
                const weight = parseFloat(weightStr);
                return { name, weight: Number.isFinite(weight) ? weight : null };
              }
              const numberMatch = trimmed.match(/^(.*?)(-?\d+(?:\.\d+)?)(?:%?)$/);
              if (numberMatch) {
                const name = numberMatch[1].trim();
                const weight = parseFloat(numberMatch[2]);
                return { name: name || trimmed, weight: Number.isFinite(weight) ? weight : null };
              }
              return { name: trimmed, weight: null };
            })
            .filter(Boolean)
            .flat();
          // If no weights, spread evenly
          if (parsed.length && !parsed.some((p) => p.weight !== null)) {
            const equalW = 1 / parsed.length;
            parsed = parsed.map((p) => ({ ...p, weight: equalW }));
          }
          console.log('Parsed muscles for rep', { exerciseId, parsed });
          let momentumVal = Number(rep?.momentum) || 0;
          if ((!parsed.length || !parsed.some((p) => p.weight !== null)) && parentItem?.muscle_focus) {
            parsed = [{ name: parentItem.muscle_focus, weight: 1 }];
            console.log('Fallback muscle_focus used', parentItem?.muscle_focus);
          }
          const totalWeight = parsed.reduce((sum, p) => (p.weight !== null ? sum + p.weight : sum), 0);
          if (momentumVal > 0 && totalWeight > 0) {
            parsed.forEach((p) => {
              if (p.weight === null) return;
              const portion = (momentumVal * p.weight) / totalWeight;
              muscleTotals[p.name] = (muscleTotals[p.name] || 0) + portion;
            });
            totalMomentum += momentumVal;
          }
        }
      }

      const muscleTotalsObj = {};
      Object.keys(muscleTotals).forEach((key) => {
        muscleTotalsObj[key] = { total: muscleTotals[key], muscleName: key };
      });

      const newBodyData = Object.keys(bodyParts)
        .map((part) => {
          const { muscleName, side } = bodyParts[part];
          const muscleInfo = muscleTotalsObj[muscleName];
          if (muscleInfo && muscleInfo.total > 0) {
            const percentage = totalMomentum ? ((muscleInfo.total / totalMomentum) * 100).toFixed(0) : 0;
            return {
              slug: part.toLowerCase(),
              intensity: percentage >= 60 ? 3 : percentage >= 30 ? 2 : 1,
              total: muscleInfo.total,
              name: muscleInfo.muscleName,
              side,
              percentage,
            };
          }
          return null;
        })
        .filter(Boolean);

      setBodyData(newBodyData);
      setTotalMomentumData(Number(totalMomentum.toFixed(1)));
      setWorkOutDetail(targetSessions);
      setLoadSelectedDate(selected || start.toISOString().split('T')[0]);
      const momentumList = Object.keys(muscleTotalsObj)
        .map((key) => {
          const total = muscleTotalsObj[key].total;
          const percent = totalMomentum ? ((total / totalMomentum) * 100).toFixed(1) : '0';
          return { name: key, total, percent };
        })
        .sort((a, b) => b.total - a.total);
      console.log('Body map distribution', {
        range: currentRange,
        sessionCount: targetSessions.length,
        totalMomentum,
        muscles: momentumList,
      });
      momentumList.forEach((m) => {
        console.log(`Muscle ${m.name} total momentum`, m.total);
      });
      setMuscleMomentumList(momentumList);
    } catch (err) {
      console.log('Monthly muscle build failed', err);
      setBodyData([]);
      setTotalMomentumData(0);
      setMuscleMomentumList([]);
    } finally {
      setLoadingBody(false);
    }
  }, [asList, client, fetchExercises, monthDate, sessions]);

  useEffect(() => {
    buildMonthlyMuscleData(sessions, selectedDate, range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthDate, sessions, selectedDate, range, exerciseMap]);

  const fetchSessionMomentum = useCallback(
    async (session_id) => {
      if (!session_id) return 0;
      try {
        const { data } = await client.graphql({
          query: listSessionItemRepsQuery,
          variables: { session_id, limit: 500 },
        });
        const reps = asList(data?.listSessionItemReps);
        return reps.reduce((sum, rep) => sum + (Number(rep?.momentum) || 0), 0);
      } catch (err) {
        console.log('Fetch session momentum failed', err);
        return 0;
      }
    },
    [asList, client]
  );

  useEffect(() => {
    let cancelled = false;
    const computeMomentum = async () => {
      if (!sessions.length) {
        if (!cancelled) {
          fetchedMomentumRef.current = new Set();
          setSessionMomentumMap({});
          setMomentumByDate({});
        }
        return;
      }
      const toFetch = sessions.filter(
        (s) => s.session_id && !fetchedMomentumRef.current.has(s.session_id)
      );
      if (!toFetch.length) return;
      const newMomentumBySession = {};
      for (const s of toFetch) {
        const total = await fetchSessionMomentum(s.session_id);
        newMomentumBySession[s.session_id] = total;
        fetchedMomentumRef.current.add(s.session_id);
      }
      if (cancelled) return;
      if (Object.keys(newMomentumBySession).length) {
        setSessionMomentumMap((prev) => ({ ...prev, ...newMomentumBySession }));
      }
    };
    computeMomentum();
    return () => {
      cancelled = true;
    };
  }, [sessions, fetchSessionMomentum]);

  useEffect(() => {
    const dateTotals = {};
    sessions.forEach((s) => {
      const dateStr = normalizeDate(s.workout_date || s.created_at);
      if (!dateStr) return;
      const total = sessionMomentumMap[s.session_id] || 0;
      dateTotals[dateStr] = (dateTotals[dateStr] || 0) + total;
    });
    setMomentumByDate(dateTotals);
  }, [sessions, sessionMomentumMap]);

  const ensureSessionDetails = useCallback(
    async (session_id) => {
      if (!session_id) return;
      setSessionLoadingMap((prev) => ({ ...prev, [session_id]: true }));
      try {
        const { data: itemData } = await client.graphql({
          query: listSessionItemsBySession,
          variables: { session_id, limit: 50 },
        });
        const items = asList(itemData?.listSessionItemsBySession);

        const { data: repsData } = await client.graphql({
          query: listSessionItemRepsQuery,
          variables: { session_id, limit: 500 },
        });
        const reps = asList(repsData?.listSessionItemReps);

        // Pull sets across indexes to show set details
        const setsByIndex = {};
        for (let idx = 1; idx <= MAX_SESSION_ITEM_INDEX; idx += 1) {
          try {
            const { data } = await client.graphql({
              query: listSessionItemSetsQuery,
              variables: { session_id, session_item_index: idx, limit: 50 },
            });
            const found = asList(data?.listSessionItemSets);
            if (found.length) {
              setsByIndex[idx] = found;
            }
          } catch (err) {
            // ignore individual set fetch errors
          }
        }

        const detailedItems = items.map((item) => {
          const itemReps = reps.filter((r) => r?.session_item_index === item.session_item_index);
          const totalMom = itemReps.reduce((sum, r) => sum + (Number(r?.momentum) || 0), 0);
          const sets = setsByIndex[item.session_item_index] || [];
          return { ...item, reps: itemReps, sets, totalMom };
        });
        setSessionDetailsMap((prev) => ({ ...prev, [session_id]: detailedItems }));
      } catch (err) {
        console.log('Fetch session details failed', err);
      } finally {
        setSessionLoadingMap((prev) => ({ ...prev, [session_id]: false }));
      }
    },
    [asList, client]
  );

  const toggleSession = async (session_id) => {
    if (expandedSessionId === session_id) {
      setExpandedSessionId(null);
      return;
    }
    setExpandedSessionId(session_id);
    await ensureSessionDetails(session_id);
  };

  const renderSession = (session) => {
    const isOpen = expandedSessionId === session.session_id;
    const details = sessionDetailsMap[session.session_id] || [];
    const loadingDetails = sessionLoadingMap[session.session_id];
    return (
      <View key={`home-sess-${session.session_id}`} style={styles.sessCard}>
        <Pressable onPress={() => toggleSession(session.session_id)} style={styles.sessHeader}>
          <View>
            <Text style={styles.sessTitle}>{formatDate(session.workout_date)}</Text>
            <Text style={styles.sessMeta}>Created: {formatDate(session.created_at)}</Text>
          </View>
          <Text style={styles.sessExpand}>{isOpen ? 'Hide' : 'View'}</Text>
        </Pressable>
        {isOpen && (
          <View style={styles.sessBody}>
            {loadingDetails ? (
              <ActivityIndicator />
            ) : details.length === 0 ? (
              <Text style={styles.muted}>No session items recorded.</Text>
            ) : (
              details.map((item) => {
                return (
                  <View key={`${session.session_id}-${item.session_item_index}`} style={styles.sessItem}>
                    <Text style={styles.sessItemTitle}>
                      Exercise {item.session_item_index}: {item.exercise_id || 'Unknown Exercise'}
                    </Text>
                    <Text style={styles.sessMeta}>
                      Muscle: {item.muscle_focus || 'N/A'} | Total Mom: {item.totalMom?.toFixed?.(1) || item.totalMom || 0}
                    </Text>
                    <Text style={styles.sessMeta}>
                      Sets: {item.sets?.length || 0} | Reps: {item.reps?.length || 0} | Workout: {item.workout_id || 'N/A'}
                    </Text>
                    {item.sets?.length ? (
                      <View style={styles.sessSetList}>
                        {item.sets.map((s, idx) => (
                          <Text key={idx} style={styles.sessMeta}>
                            Set {s.session_item_set_index ?? idx + 1}: Reps {s.reps_completed ?? 'N/A'} | Mom {s.momentum ?? 'N/A'}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                    {item.reps?.length ? (
                      <View style={styles.sessSetList}>
                        {item.reps.slice(0, 3).map((r, idx) => (
                          <Text key={idx} style={styles.sessMeta}>
                            Rep {r.session_item_rep_index ?? idx + 1}: Mom {r.momentum ?? 'N/A'}
                          </Text>
                        ))}
                        {item.reps.length > 3 ? (
                          <Text style={styles.sessMeta}>+{item.reps.length - 3} more reps</Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}
          </View>
        )}
      </View>
    );
  };

  const handleAction = async (key) => {
    switch (key) {
      case 'runner':
        navigation.navigate('WorkoutRunner');
        break;
      case 'builder': {
        const tId = await ensureTrainerId();
        navigation.navigate('CreateWorkout', { trainer_id: tId || undefined });
        break;
      }
      case 'library':
        navigation.navigate('WorkoutLibrary');
        break;
      case 'sessions':
        navigation.navigate('SessionDashboard');
        break;
      case 'exercises':
        navigation.navigate('ExerciseLibrary');
        break;
      case 'trainerDirectory':
        navigation.navigate('TrainerDirectory');
        break;
      case 'profile':
        navigation.navigate('ProfileSetup', { next: 'Home' });
        break;
      case 'trainerDash': {
        const tId = await ensureTrainerId();
        if (tId) navigation.navigate('TrainerDashboard', { trainer_id: tId });
        break;
      }
      case 'signOut':
        try {
          await signOut();
        } catch (err) {
          console.log('Sign out failed', err);
        }
        break;
      default:
        Alert.alert('Coming Soon', `The ${key} feature is under development.`);
    }
  };

  const backToAuth = async () => {
    try {
      await signOut();
      navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
    } catch (e) {
      Alert.alert('Sign out failed', e?.message || 'Please try again.');
    }
  };

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Choose where to go</Text>

        <View style={styles.grid}>
          {(() => {
            const base = [...actions];
            if (trainerId && userRole === 'trainer') base.push({ label: 'Trainer Dashboard', key: 'trainerDash' });
            return base.map((action) => (
              <TouchableOpacity
                key={action.key}
                style={[styles.card, action.accent && styles.cardAccent]}
                onPress={() => handleAction(action.key)}
              >
              <Text style={[styles.cardText, action.accent && styles.cardTextAccent]}>
                {action.label}
              </Text>
            </TouchableOpacity>
            ));
          })()}
        </View>

        <View style={styles.mapCard}>
          <View style={styles.rowMomentumHeading}>
            <Text style={styles.mapTitle}>Load Distribution</Text>
            <View style={styles.mapHeaderRight}>
              {['week', 'month', 'year'].map((opt) => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => handleRangeChange(opt)}
                  style={[
                    styles.rangeChip,
                    range === opt && styles.rangeChipActive,
                  ]}
                >
                  <Text style={[styles.rangeChipText, range === opt && styles.rangeChipTextActive]}>
                    {opt === 'week' ? '1W' : opt === 'month' ? '1M' : '1Y'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.bodyHighlighterContainer}>
            <Body
              data={bodyData}
              gender={userGender === 'female' ? 'female' : 'male'}
              side="front"
              scale={0.7}
              border="#dfdfdf"
              colors={['red', 'orange', 'yellow']}
            />
            <Body
              data={bodyData}
              gender={userGender === 'female' ? 'female' : 'male'}
              side="back"
              scale={0.7}
              border="#dfdfdf"
              colors={['red', 'green', 'yellow']}
            />
          </View>

          {bodyData.length ? (
            <View style={styles.muscleList}>
              {bodyData.map((muscle, index) => (
                <View
                  key={index}
                  style={[styles.muscleChip, getMuscleBoxColor(muscle.percentage)]}
                >
                  <Text style={styles.muscleName}>{muscle.name}</Text>
                  <Text style={styles.musclePct}>{muscle.percentage}%</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>No muscle data for this date yet.</Text>
          )}

          {muscleMomentumList.length ? (
            <View style={styles.momentumList}>
              {muscleMomentumList.map((m, idx) => (
                <Text key={idx} style={styles.musclePct}>
                  {m.name}: {m.percent}% ({m.total.toFixed(1)})
                </Text>
              ))}
            </View>
          ) : null}

          {totalMomentumData ? (
            <View style={styles.momentumRow}>
              <View style={styles.momentumItem}>
                <FontAwesome5 name="dumbbell" color="#000" size={20} />
                <Text style={styles.momentumValue}>{totalMomentumData}</Text>
                <Text style={styles.momentumLabel}>Momentum</Text>
              </View>
              <View style={styles.momentumItem}>
                <FontAwesome5 name="trophy" color="#000" size={20} />
                <Text style={styles.momentumValue}>{workoutDetail.length}</Text>
                <Text style={styles.momentumLabel}>Exercises</Text>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.homeCalCard}>
          <View style={styles.homeCalHeader}>
            <TouchableOpacity onPress={() => setMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>
              <Text style={styles.homeCalNav}>{'<'}</Text>
            </TouchableOpacity>
            <Text style={styles.homeCalTitle}>
              {monthDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </Text>
            <TouchableOpacity onPress={() => setMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>
              <Text style={styles.homeCalNav}>{'>'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.homeCalGrid}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <Text key={d} style={styles.homeCalDow}>{d}</Text>
            ))}
            {(() => {
              const year = monthDate.getFullYear();
              const month = monthDate.getMonth();
              const firstDay = new Date(year, month, 1).getDay();
              const daysInMonth = new Date(year, month + 1, 0).getDate();
              const cells = [];
              for (let i = 0; i < firstDay; i += 1) {
                cells.push(<View key={`pad-${i}`} style={styles.homeCalCell} />);
              }
              const sessionDates = new Set(
                sessions
                  .map((s) => normalizeDate(s.workout_date || s.created_at))
                  .filter((d) => d && d.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`))
              );
              for (let day = 1; day <= daysInMonth; day += 1) {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const hasSession = sessionDates.has(dateStr);
                const isSelected = selectedDate === dateStr;
                const dayMomentum = momentumByDate[dateStr];
                cells.push(
                  <TouchableOpacity
                    key={dateStr}
                    style={[
                      styles.homeCalCell,
                      isSelected && styles.homeCalCellSelected,
                    ]}
                    onPress={() => setSelectedDate(dateStr)}
                  >
                    <Text style={[styles.homeCalCellText, isSelected && styles.homeCalCellTextSelected]}>{day}</Text>
                    {dayMomentum !== undefined ? (
                      <Text style={styles.homeCalMomentum}>{Math.round(dayMomentum)}</Text>
                    ) : null}
                    {hasSession ? <View style={styles.homeCalDot} /> : null}
                  </TouchableOpacity>
                );
              }
              return cells;
            })()}
          </View>
        </View>

        <View style={styles.sessionSection}>
          <Text style={styles.sessionSectionTitle}>Recent Sessions</Text>
          {sessionsLoading ? <ActivityIndicator /> : null}
          {sessionsError ? <Text style={styles.errorText}>{sessionsError}</Text> : null}
          {!sessionsLoading && !sessions.length ? (
            <Text style={styles.muted}>No sessions recorded yet.</Text>
          ) : null}
          {sessions.slice(0, 5).map(renderSession)}
        </View>

        <TouchableOpacity onPress={backToAuth} style={styles.signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    padding: 20,
    paddingBottom: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#d0494b',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#b55658',
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    flexBasis: '48%',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f6cdd0',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardAccent: {
    backgroundColor: '#d0494b',
    borderColor: '#d0494b',
  },
  cardText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#b55658',
  },
  cardTextAccent: {
    color: '#fff',
  },
  signOut: {
    marginTop: 24,
    alignSelf: 'flex-start',
  },
  signOutText: {
    color: '#d0494b',
    fontWeight: '600',
  },
  mapCard: {
    marginTop: 24,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f2f4f7',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  rowMomentumHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  mapTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors?.APP_BLACK || '#0f172a',
  },
  mapHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mapDate: {
    fontSize: 14,
    color: '#475569',
  },
  rangeChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  rangeChipActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  rangeChipText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '700',
  },
  rangeChipTextActive: {
    color: '#fff',
  },
  mapDateLink: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors?.APP_BLUE || '#2563eb',
  },
  bodyHighlighterContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
  },
  muscleList: {
    marginTop: 16,
  },
  muscleChip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 8,
  },
  muscleName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  musclePct: {
    fontSize: 14,
    color: '#0f172a',
  },
  momentumList: {
    marginTop: 8,
    gap: 2,
  },
  muted: {
    marginTop: 8,
    color: '#94a3b8',
  },
  momentumRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    marginTop: 16,
  },
  momentumItem: {
    alignItems: 'center',
  },
  momentumValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
  },
  momentumLabel: {
    fontSize: 14,
    color: '#475569',
  },
  homeCalCard: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  homeCalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  homeCalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  homeCalNav: {
    fontSize: 18,
    color: '#0f172a',
  },
  homeCalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  homeCalDow: {
    width: '13%',
    textAlign: 'center',
    fontSize: 12,
    color: '#475569',
    marginBottom: 4,
  },
  homeCalCell: {
    width: '13%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#f8fafc',
  },
  homeCalCellSelected: {
    backgroundColor: '#e0ecff',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  homeCalCellText: {
    fontSize: 12,
    color: '#0f172a',
  },
  homeCalCellTextSelected: {
    color: '#1d4ed8',
    fontWeight: '700',
  },
  homeCalMomentum: {
    fontSize: 11,
    color: '#0f172a',
    marginTop: 2,
  },
  homeCalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3b82f6',
    marginTop: 2,
  },
  sessionSection: {
    marginTop: 24,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
  },
  sessionSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  errorText: {
    color: '#b91c1c',
  },
  sessCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginTop: 6,
  },
  sessHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sessTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  sessMeta: {
    fontSize: 12,
    color: '#475569',
  },
  sessExpand: {
    color: '#2563eb',
    fontWeight: '700',
  },
  sessBody: {
    marginTop: 8,
    gap: 6,
  },
  sessItem: {
    paddingVertical: 6,
    borderTopWidth: 1,
    borderColor: '#e2e8f0',
  },
  sessItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  sessSetList: {
    marginTop: 4,
    gap: 2,
  },
});

