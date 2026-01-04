import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { generateClient } from 'aws-amplify/api';

const LIST_TRAINERS = /* GraphQL */ `
  query ListTrainers($limit: Int, $nextToken: String) {
    listTrainers(limit: $limit, nextToken: $nextToken) {
      items { trainer_id user_id training_focus }
      nextToken
    }
  }
`;

const GET_USER = /* GraphQL */ `
  query GetUser($user_id: ID!) {
    getUser(user_id: $user_id) {
      first_name
      last_name
      city
      state
      bio
    }
  }
`;

export default function TrainerDirectory({ navigation }) {
  const client = useMemo(() => generateClient({ authMode: 'userPool' }), []);
  const [trainers, setTrainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      const results = [];
      let nextToken;
      do {
        const { data } = await client.graphql({
          query: LIST_TRAINERS,
          variables: { limit: 100, nextToken },
        });
        const page = data?.listTrainers;
        if (!page) break;
        results.push(...(page.items || []));
        nextToken = page.nextToken;
      } while (nextToken);
      // Fetch user info for each trainer (name/location/bio)
      const userIds = [...new Set(results.map((t) => t.user_id).filter(Boolean))];
      const userMap = {};
      for (const uid of userIds) {
        try {
          const { data: userData } = await client.graphql({
            query: GET_USER,
            variables: { user_id: uid },
          });
          if (userData?.getUser) userMap[uid] = userData.getUser;
        } catch (err) {
          console.log('TrainerDirectory user fetch failed', uid, err);
        }
      }
      const merged = results.map((t) => ({ ...t, user: userMap[t.user_id] }));
      setTrainers(merged);
    } catch (err) {
      console.log('TrainerDirectory load failed', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('TrainerProfile', { trainer_id: item.trainer_id, user_id: item.user_id })}
    >
      <Text style={styles.title}>
        {item?.user?.first_name || ''} {item?.user?.last_name || ''}
      </Text>
      <Text style={styles.subtitle}>
        {item?.user?.city || ''}{item?.user?.city && item?.user?.state ? ', ' : ''}{item?.user?.state || ''}
      </Text>
      <Text style={styles.meta}>Focus: {item.training_focus || 'N/A'}</Text>
      <Text style={styles.bio} numberOfLines={2}>{item?.user?.bio || 'No bio provided.'}</Text>
    </TouchableOpacity>
  );

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>Loading trainers...</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={trainers}
      keyExtractor={(item) => item.trainer_id}
      renderItem={renderItem}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
      contentContainerStyle={trainers.length ? styles.list : styles.center}
      ListEmptyComponent={<Text>No trainers found.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  title: {
    fontWeight: '700',
    fontSize: 16,
  },
  subtitle: {
    color: '#475569',
  },
  meta: {
    marginTop: 4,
    color: '#0f172a',
    fontWeight: '600',
  },
  bio: {
    marginTop: 6,
    color: '#475569',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
});
