import { StyleSheet, Text, View, TouchableOpacity, Image, Button } from 'react-native';
import React from 'react';
import Colors from '../../Theme/Colors';
import { useNavigation } from '@react-navigation/native';

const UserCardItem = ({ item, activeUserData, permissionOnPress, onPress, children }) => {
  const navigation = useNavigation(); // Access the navigation object

  const Demographic = item.Demographic;
  const FitnessGoals = item.FitnessGoals;


  return (
    <TouchableOpacity onPress={onPress} style={styles.userCard}>
      <Image
        source={{ uri: 'https://via.placeholder.com/50' }}
        style={styles.profileImage}
      />
      <View style={styles.userInfo}>
        <Text style={styles.titleMainHeading}>
          Name: <Text style={styles.titleSubHeading}>{Demographic.name}</Text>
        </Text>
        <Text style={[styles.titleMainHeading, { fontSize: 15 }]}>
          Fitness Focus: <Text style={[styles.titleSubHeading, { fontSize: 14 }]}>{FitnessGoals.goals}</Text>
        </Text>
        <Text style={[styles.titleMainHeading, { fontSize: 15 }]}>
          Location: <Text style={[styles.titleSubHeading, { fontSize: 14 }]}>{Demographic.state}</Text>
        </Text>
        <Text style={[styles.titleMainHeading, { fontSize: 15 }]}>
          Age: <Text style={[styles.titleSubHeading, { fontSize: 14 }]}>{Demographic.age}</Text>
        </Text>
         <Text style={[styles.titleMainHeading, { fontSize: 15 }]}>
          Workout Purchased: <Text style={[styles.titleSubHeading, { fontSize: 14 }]}>{Demographic.workoutPurchased}</Text>
        </Text>
         <Text style={[styles.titleMainHeading, { fontSize: 15 }]}>
          Service Performed: <Text style={[styles.titleSubHeading, { fontSize: 14 }]}>{Demographic.servicePerformed}</Text>
        </Text>
         <Text style={[styles.titleSubHeading, { fontSize: 15 }]}>
          Last Workout Performed: <Text style={[styles.titleSubHeading, { fontSize: 14 }]}>{Demographic.lastWorkoutPerformed}</Text>
        </Text>
         <Text style={[styles.titleSubHeading, { fontSize: 15 }]}>
          Service EndDate: <Text style={[styles.titleSubHeading, { fontSize: 14 }]}>{Demographic.serviceEndDate}</Text>
        </Text>

        {/* <TouchableOpacity style={styles.button} onPress={permissionOnPress}>
          <Text style={styles.buttonText}>
            {activeUserData.permissions?.[item.id] ? 'Revoke Permission' : 'Grant Permission'}
          </Text>
        </TouchableOpacity> */}
      {/* Render children */}
      {children}
        

      </View>
    </TouchableOpacity>
  );
};

export default UserCardItem;

const styles = StyleSheet.create({
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.APP_WHITE,
    padding: 10,
    marginHorizontal: 18,
    marginBottom: 15,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: Colors.APP_RED,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  profileImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 10,
  },
  userInfo: {
    flex: 1,
  },
  titleMainHeading: {
    fontSize: 17,
    fontWeight: 'bold',
    color: Colors.APP_RED,
  },
  titleSubHeading: {
    fontSize: 14,
    fontWeight: 'normal',
    color: Colors.APP_BLACK,
  },
  button: {
    // width: responsiveWidth(50),
    backgroundColor: Colors.APP_RED,
    padding: 10,
    borderRadius: 5,
    marginTop: 10,
  },
  buttonText: {
    color: Colors.APP_WHITE,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});
