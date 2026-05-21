import React, { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet, TextInput, SafeAreaView, TouchableOpacity, KeyboardAvoidingView, Platform } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from '@expo/vector-icons';
import UserCardItem from "../Components/Cards/UserCardItem";
import Colors from "../Theme/Colors";
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser } from 'aws-amplify/auth';
import { listPermissionsByTrainer, listSessionsByCustomer, getUser } from '../graphql/queries';

const LIST_SERVICES = /* GraphQL */ `
  query ListVirtualTrainingServicesByTrainer($trainer_id: ID!, $limit: Int) {
    listVirtualTrainingServicesByTrainer(trainer_id: $trainer_id, limit: $limit) {
      items {
        service_id
        stripe_product_id
        service_name
        duration_weeks
        workout_ids
      }
    }
  }
`;

import { listTrainers } from "../graphql/queries";
import { ActivityIndicator } from "react-native";

const client = generateClient({ authMode: 'userPool' });

// DUMMY_CLIENTS removed for production logic

export default function ClientListScreen({ route }) {
    const navigation = useNavigation();
    const trainerIdFromRoute = route?.params?.trainer_id;
    const [searchQuery, setSearchQuery] = useState('');
    const [clients, setClients] = useState([]);
    const [filteredClients, setFilteredClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [permissions, setPermissions] = useState({});

    useEffect(() => {
        fetchClients();
    }, []);

    async function fetchClients() {
        try {
            setLoading(true);
            const current = await getCurrentUser();
            console.log("Current User ID:", current.userId);
            let trainerId = trainerIdFromRoute;

            if (!trainerId) {
                const trainerRes = await client.graphql({
                    query: listTrainers,
                    variables: { filter: { user_id: { eq: current.userId } }, limit: 500 }
                });
                
                console.log("Raw Trainer Query Result:", JSON.stringify(trainerRes.data.listTrainers.items, null, 2));
                
                // Reverted to original logic
                trainerId = trainerRes.data.listTrainers.items[0]?.trainer_id;
            }
            
            console.log("Resolved Trainer ID:", trainerId);

            if (!trainerId) {
                console.log("No trainer ID found for this user.");
                setLoading(false);
                return;
            }

            const permRes = await client.graphql({
                query: listPermissionsByTrainer,
                variables: { trainer_id: trainerId }
            });
            console.log("Total Permissions count:", permRes.data.listPermissionsByTrainer.items.length);
            
            // Only show clients who purchased a 'service'
            const perms = permRes.data.listPermissionsByTrainer.items.filter(p => p.product_type === 'service');
            console.log("Virtual Training Clients count:", perms.length);

            const servicesRes = await client.graphql({
                query: LIST_SERVICES,
                variables: { trainer_id: trainerId, limit: 100 }
            });
            const allServices = servicesRes.data.listVirtualTrainingServicesByTrainer?.items || [];
            console.log(`Fetched ${allServices.length} trainer services for matching.`);

            const clientData = await Promise.all(perms.map(async (perm) => {
                try {
                    // Fetch user and session details in parallel
                    const [userRes, sessRes] = await Promise.all([
                        client.graphql({ query: getUser, variables: { user_id: perm.user_id } }),
                        client.graphql({ query: listSessionsByCustomer, variables: { customer_id: perm.user_id, limit: 100 } })
                    ]);
                    
                    const u = userRes.data.getUser;
                    
                    // Added fallback to handle both direct array and connection (items) formats
                    const sessData = sessRes.data.listSessionsByCustomer;
                    const sessions = sessData?.items || sessData || [];
                    
                    // Match the service from our bulk fetch
                    const service = allServices.find(s => s.service_id === perm.resource_id || s.stripe_product_id === perm.resource_id);
                    
                    console.log(`Fetched Data for Client ${perm.user_id}:`);
                    console.log(`- User age:`, u?.age);
                    console.log(`- Sessions found:`, sessions.length);
                    console.log(`- Service matched:`, service ? 'Yes' : 'No');

                    // Calculate real expiry based on service duration
                    const durationWeeks = service?.duration_weeks || 0;
                    const purchaseDate = new Date(perm.purchased_at || Date.now());
                    const expiryDate = new Date(purchaseDate.getTime() + (durationWeeks * 7 * 24 * 60 * 60 * 1000));

                    return {
                        id: perm.user_id,
                        Demographic: {
                            name: u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : 'Unknown User',
                            state: u?.state || 'N/A',
                            age: u?.age || 'N/A',
                            profile_image_url: u?.profile_image_url,
                            workoutPurchased: service?.workout_ids?.length || 0,
                            servicePerformed: sessions.length,
                            lastWorkoutPerformed: sessions[0]?.workout_date ? new Date(sessions[0].workout_date).toLocaleDateString() : 'N/A',
                            serviceEndDate: durationWeeks > 0 ? expiryDate.toLocaleDateString() : 'N/A',
                        },
                        FitnessGoals: { goals: u?.fitness_goal || 'N/A' }
                    };
                } catch (e) {
                    console.log("Error loading detail for user:", perm.user_id, e);
                    return null;
                }
            }));

            const finalClients = clientData.filter(Boolean);
            setClients(finalClients);
            setFilteredClients(finalClients);
        } catch (err) {
            console.error("Error fetching clients:", err);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        const filtered = clients.filter(c => 
            c.Demographic.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
        setFilteredClients(filtered);
    }, [searchQuery, clients]);

    const handlePermissionToggle = (clientId) => {
        setPermissions(prev => ({
            ...prev,
            [clientId]: !prev[clientId]
        }));
    };

    const renderItem = ({ item }) => (
        <UserCardItem 
            item={item} 
            activeUserData={{ permissions }}
            permissionOnPress={() => handlePermissionToggle(item.id)}
            onPress={() => navigation.navigate('Home', { fromClientList: true, clientData: item })}
        />
    );

    return (
        <SafeAreaView style={styles.container}>
            <KeyboardAvoidingView 
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={{ flex: 1 }}
            >
                {/* <View style={styles.header}>
                    <Text style={styles.headerTitle}>Clients</Text>
                </View> */}
                
                <View style={styles.searchSection}>
                    <View style={styles.searchBarContainer}>
                        <Ionicons name="search" size={20} color={Colors.GREY_TEXT_COLOR} style={styles.searchIcon} />
                        <TextInput
                            style={styles.searchBar}
                            placeholder="Search clients by name..."
                            placeholderTextColor={Colors.GREY_TEXT_COLOR}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            autoCorrect={false}
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => setSearchQuery('')}>
                                <Ionicons name="close-circle" size={20} color={Colors.GREY_TEXT_COLOR} />
                            </TouchableOpacity>
                        )}
                    </View>
                </View>

                {loading ? (
                    <View style={styles.emptyContainer}>
                        <ActivityIndicator size="large" color={Colors.APP_BLUE} />
                        <Text style={[styles.emptyText, { marginTop: 20 }]}>Loading your clients...</Text>
                    </View>
                ) : (
                    <FlatList
                        data={filteredClients}
                        keyExtractor={(item) => item.id}
                        renderItem={renderItem}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        ListEmptyComponent={
                            <View style={styles.emptyContainer}>
                                <Ionicons name="search-outline" size={60} color={Colors.DIVIDER} />
                                <Text style={styles.emptyText}>
                                    {searchQuery.length > 0 
                                        ? `No clients found matching "${searchQuery}"`
                                        : "You don't have any clients yet."
                                    }
                                </Text>
                            </View>
                        }
                    />
                )}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.APP_GREY,
    },
    header: {
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 5,
        backgroundColor: Colors.APP_WHITE,
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: 'bold',
        color: Colors.APP_BLACK,
    },
    searchSection: {
        padding: 15,
        backgroundColor: Colors.APP_WHITE,
        borderBottomWidth: 1,
        borderBottomColor: Colors.DIVIDER,
    },
    searchBarContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Colors.INPUT_BACKGROUND,
        borderRadius: 12,
        paddingHorizontal: 12,
        height: 50,
    },
    searchIcon: {
        marginRight: 10,
    },
    searchBar: {
        flex: 1,
        fontSize: 16,
        color: Colors.APP_BLACK,
        height: '100%',
    },
    listContent: {
        paddingVertical: 15,
        paddingBottom: 30,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 80,
        paddingHorizontal: 40,
    },
    emptyText: {
        fontSize: 16,
        color: Colors.GREY_TEXT_COLOR,
        textAlign: 'center',
        marginTop: 10,
    }
});