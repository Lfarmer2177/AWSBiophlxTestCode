import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { generateClient } from 'aws-amplify/api';
import awsconfig from '../aws-exports';

const LIST_EXERCISES_MINIMAL = /* GraphQL */ `
  query ListExercises($limit: Int, $nextToken: String) {
    listExercises(limit: $limit, nextToken: $nextToken) {
      items {
        exercise_id
        name
        category
        exercise_image
      }
      nextToken
    }
  }
`;

const GET_EXERCISE_BY_ID = /* GraphQL */ `
  query GetExercise($exercise_id: ID!) {
    getExercise(exercise_id: $exercise_id) {
      exercise_id
      name
      category
      equipment_required
      instructions
      muscle_group
      exercise_image
    }
  }
`;

const PLACEHOLDER =
  'https://dummyimage.com/320x200/b0b0b0/ffffff.png&text=Exercise';

export default function ExerciseLibrary() {
  const client = useMemo(
    () =>
      generateClient({
        authMode: 'apiKey',
        apiKey: awsconfig?.API?.GraphQL?.apiKey,
      }),
    []
  );

  const [items, setItems] = useState([]);
  const [detailsCache, setDetailsCache] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const ensureExerciseDetails = useCallback(
    async (exercise_id) => {
      if (!exercise_id || detailsCache[exercise_id]) {
        return detailsCache[exercise_id] || null;
      }
      try {
        const { data } = await client.graphql({
          query: GET_EXERCISE_BY_ID,
          variables: { exercise_id },
        });
        const detail = normalizeExerciseDetail(data?.getExercise) || null;
        if (detail) {
          setDetailsCache((prev) => ({ ...prev, [exercise_id]: detail }));
        }
        return detail;
      } catch (err) {
        console.log('Exercise detail fetch failed', exercise_id, err);
        return null;
      }
    },
    [client, detailsCache]
  );

  const loadExercises = useCallback(
    async (isRefresh = false) => {
      try {
        isRefresh ? setRefreshing(true) : setLoading(true);
        setError(null);

        const results = [];
        let nextToken;
        do {
          const variables = { limit: 100, nextToken };
          let page = null;
          try {
            const { data } = await client.graphql({
              query: LIST_EXERCISES_MINIMAL,
              variables,
            });
            page = data?.listExercises ?? null;
          } catch (pageErr) {
            console.log('Exercise page load failed', pageErr);
            page = null;
          }
          if (!page) break;
          const block = (page.items ?? []).filter((entry) => entry && entry.exercise_id);
          results.push(...block);
          nextToken = page.nextToken;
        } while (nextToken);

        const normalized = results.map((entry) => ({
          exercise_id: unwrapString(entry.exercise_id),
          name: unwrapString(entry.name),
          category: unwrapString(entry.category),
          exercise_image: formatImageUri(
            unwrapString(entry.exercise_image || entry.Exercise_Image)
          ),
        }));
        normalized.sort((a, b) => a.exercise_id.localeCompare(b.exercise_id));
        console.log('ExerciseLibrary results', normalized);
        setItems(normalized);
        if (normalized.length) {
          const idsToPreload = normalized.slice(0, 50).map((e) => e.exercise_id);
          await Promise.all(idsToPreload.map((id) => ensureExerciseDetails(id)));
        }
      } catch (err) {
        console.log('Failed to load exercises', err);
        setError(err?.message || 'Unable to load exercises right now.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [client, ensureExerciseDetails]
  );

  useEffect(() => {
    loadExercises();
  }, [loadExercises]);

  useEffect(() => {
    if (expandedId) {
      ensureExerciseDetails(expandedId);
    }
  }, [expandedId, ensureExerciseDetails]);

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1c6ef2" />
        <Text style={styles.helper}>Fetching exercises...</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.exercise_id}
        renderItem={({ item }) => {
          const detail = detailsCache[item.exercise_id];
          const muscles = detail ? parseMuscleGroups(detail.muscle_group) : [];
          const thumb = item.exercise_image || detail?.exercise_image || PLACEHOLDER;
          const isExpanded = expandedId === item.exercise_id;
          return (
            <TouchableOpacity
              style={[styles.rowCard, isExpanded && styles.selectedRow]}
              onPress={() => {
                const nextId = isExpanded ? null : item.exercise_id;
                setExpandedId(nextId);
                if (nextId) ensureExerciseDetails(nextId);
              }}
            >
              <Image source={{ uri: thumb }} style={styles.thumbnail} resizeMode="cover" />
              <View style={{ flex: 1 }}>
                <Text style={styles.exerciseId}>{unwrapString(item.exercise_id)}</Text>
                {item.name ? <Text style={styles.name}>{item.name}</Text> : null}
                <Text style={styles.categoryChip}>{item.category || 'Unknown'}</Text>
                {isExpanded ? (
                  detail ? (
                    <View style={styles.expandedSection}>
                      <Image
                        source={{ uri: detail.exercise_image || thumb || PLACEHOLDER }}
                        style={styles.expandedImage}
                        resizeMode="contain"
                      />
                      <Text style={styles.detailHeading}>Muscle Groups</Text>
                      {muscles.length ? (
                        muscles.map((entry, idx) => (
                          <Text key={`${entry.name}-${idx}`} style={styles.detailText}>
                            {entry.value !== null ? `${entry.name}: ${entry.value.toFixed(1)}%` : entry.name}
                          </Text>
                        ))
                      ) : (
                        <Text style={styles.muted}>No muscle data provided.</Text>
                      )}

                      <Text style={[styles.detailHeading, { marginTop: 6 }]}>Instructions</Text>
                      {toArray(detail.instructions).length ? (
                        toArray(detail.instructions).map((entry, idx) => (
                          <Text key={idx} style={styles.detailText}>
                            {idx + 1}. {entry}
                          </Text>
                        ))
                      ) : (
                        <Text style={styles.muted}>No instructions provided.</Text>
                      )}
                    </View>
                  ) : (
                    <Text style={styles.musclePreviewMuted}>Loading details...</Text>
                  )
                ) : (
                  <Text style={styles.musclePreviewMuted}>Tap to expand</Text>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text>No exercises found.</Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadExercises(true)} />
        }
        contentContainerStyle={items.length ? styles.list : styles.center}
      />
    </View>
  );
}

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

const parseMuscleGroups = (value) => {
  return toArray(value).map((entry) => {
    if (typeof entry !== 'string') return { name: String(entry), value: null };
    const parts = entry.split(':');
    const name = parts[0]?.trim() || entry;
    const rawValue = parts[1]?.trim();
    const numericValue = rawValue ? Number.parseFloat(rawValue) : null;
    return { name, value: Number.isFinite(numericValue) ? numericValue * 100 : null };
  });
};

const formatImageUri = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && value.startsWith('http')) {
    return value;
  }
  if (value.startsWith('s3://')) {
    const without = value.slice('s3://'.length);
    const separator = without.indexOf('/');
    if (separator !== -1) {
      const bucket = without.slice(0, separator);
      const key = without.slice(separator + 1);
      return `https://${bucket}.s3.amazonaws.com/${key}`;
    }
  }
  return `https://s3.amazonaws.com/${value}`;
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

const normalizeExerciseDetail = (raw) => {
  if (!raw) return null;
  const imageVal = raw.exercise_image || raw.Exercise_Image;
  return {
    exercise_id: unwrapString(raw.exercise_id),
    name: unwrapString(raw.name),
    category: unwrapString(raw.category),
    equipment_required: toArray(raw.equipment_required).map(unwrapString),
    instructions: toArray(raw.instructions).map(unwrapString),
    muscle_group: toArray(raw.muscle_group).map(unwrapString),
    exercise_image: formatImageUri(unwrapString(imageVal)),
  };
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  list: {
    paddingBottom: 20,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  selectedRow: {
    borderColor: '#4f46e5',
    borderWidth: 1,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 10,
    marginRight: 12,
    backgroundColor: '#f1f1f1',
  },
  exerciseId: {
    fontSize: 14,
    fontWeight: '600',
  },
  name: {
    color: '#444',
    fontSize: 12,
  },
  categoryChip: {
    marginTop: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#eef2ff',
    color: '#4338ca',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 11,
  },
  musclePreview: {
    color: '#4b5563',
    fontSize: 12,
    marginTop: 6,
  },
  musclePreviewMuted: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 6,
  },
  helper: {
    marginTop: 8,
    color: '#555',
  },
  errorBanner: {
    backgroundColor: '#fee',
    padding: 12,
    borderRadius: 8,
    margin: 16,
  },
  errorText: {
    color: '#a40000',
    textAlign: 'center',
  },
  detailWrapper: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  expandedSection: {
    marginTop: 8,
    gap: 4,
  },
  expandedImage: {
    width: '100%',
    height: 220,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: '#e5e7eb',
  },
  detailCard: {
    marginTop: 6,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  detailTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },
  detailImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: '#ddd',
  },
  detailSection: {
    marginBottom: 16,
  },
  detailHeading: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  detailText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  muted: {
    color: '#777',
    fontStyle: 'italic',
  },
});
