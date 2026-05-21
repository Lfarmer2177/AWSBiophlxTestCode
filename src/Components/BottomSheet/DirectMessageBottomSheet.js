import React, { useRef, useEffect } from 'react';
import { View, TextInput, StyleSheet, Text, Alert, TouchableOpacity } from 'react-native';
import * as MailComposer from 'expo-mail-composer';
import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import CustomButton from '../Button/CustomButton';
import Colors from '../../Theme/Colors';
import { Ionicons } from '@expo/vector-icons';

const DirectMessageBottomSheet = ({ isVisible, onClose, sendTo, recipientName }) => {
  const bottomSheetRef = useRef(null);
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [message, setMessage] = React.useState('');

  useEffect(() => {
    if (isVisible) {
      bottomSheetRef.current?.expand();
    } else {
      bottomSheetRef.current?.close();
    }
  }, [isVisible]);

  const handleSend = async () => {
    if (!firstName || !lastName || !email || !phone || !message) {
      Alert.alert('Incomplete Fields', 'Please fill all fields to send your message.');
      return;
    }

    const emailBody = `
    <html>
      <body style="font-family: sans-serif; padding: 20px;">
        <h2 style="color: ${Colors.APP_RED};">New Message for ${recipientName}</h2>
        <p><strong>From:</strong> ${firstName} ${lastName}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <hr style="border: 1px solid #eee; margin: 20px 0;">
        <p><strong>Message:</strong></p>
        <p style="background: #f9f9f9; padding: 15px; border-radius: 8px;">${message}</p>
      </body>
    </html>
  `;

    try {
      const isAvailable = await MailComposer.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert('Email Unavailable', 'No email account is configured on this device.');
        return;
      }

      const result = await MailComposer.composeAsync({
        recipients: [sendTo || 'support@biophlx.com'],
        subject: `Biophlx Message: From ${firstName} ${lastName}`,
        body: emailBody,
        isHtml: true,
      });

      if (result.status === 'sent') {
        Alert.alert('Success', 'Your message has been sent successfully!');
        onClose();
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to open email composer. Please check your settings.');
    }
  };

  const renderBackdrop = React.useCallback(
    (props) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
      />
    ),
    []
  );

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={isVisible ? 0 : -1}
      snapPoints={['95%']}
      onClose={onClose}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{ backgroundColor: Colors.APP_RED }}
    >
      <BottomSheetView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Get in Touch</Text>
          {recipientName && (
            <Text style={styles.recipientSub}>with <Text style={styles.nameHighlight}>{recipientName}</Text></Text>
          )}
        </View>

        <View style={styles.form}>
          <View style={styles.row}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>First Name</Text>
              <TextInput 
                style={styles.input} 
                value={firstName} 
                onChangeText={setFirstName}
                placeholder="John"
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Last Name</Text>
              <TextInput 
                style={styles.input} 
                value={lastName} 
                onChangeText={setLastName}
                placeholder="Doe"
              />
            </View>
          </View>

          <Text style={styles.label}>Email Address</Text>
          <TextInput 
            style={styles.input} 
            value={email} 
            onChangeText={setEmail} 
            keyboardType="email-address"
            placeholder="john.doe@example.com"
            autoCapitalize="none"
          />

          <Text style={styles.label}>Phone Number</Text>
          <TextInput 
            style={styles.input} 
            value={phone} 
            onChangeText={setPhone} 
            keyboardType="phone-pad"
            placeholder="+1 (555) 000-0000"
          />

          <Text style={styles.label}>Message</Text>
          <TextInput 
            style={styles.textArea} 
            value={message} 
            onChangeText={setMessage} 
            multiline 
            numberOfLines={4}
            placeholder="Type your message here..."
            textAlignVertical="top"
          />

          <View style={styles.footerStyle}>
            <CustomButton
              title={'Cancel'}
              buttonStyle={styles.cancelButton}
              textStyle={{ color: Colors.APP_RED }}
              onPress={onClose}
            />

            <CustomButton
              title={'Send Message'}
              buttonStyle={styles.sendButton}
              textStyle={{ color: Colors.APP_WHITE }}
              onPress={handleSend}
            />
          </View>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  container: { 
    padding: 24,
    flex: 1,
  },
  header: {
    marginBottom: 24,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.APP_BLACK,
  },
  recipientSub: {
    fontSize: 16,
    color: Colors.GREY_TEXT_COLOR,
    marginTop: 4,
  },
  nameHighlight: {
    color: Colors.APP_RED,
    fontWeight: '600',
  },
  form: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  inputGroup: {
    flex: 1,
  },
  label: { 
    fontSize: 14, 
    fontWeight: '600', 
    color: Colors.APP_BLACK,
    marginBottom: 8,
    marginTop: 12,
  },
  input: { 
    height: 48, 
    borderColor: '#E2E8F0', 
    borderWidth: 1, 
    borderRadius: 12, 
    paddingHorizontal: 16,
    backgroundColor: '#F8FAFC',
    fontSize: 16,
  },
  textArea: { 
    height: 120, 
    borderColor: '#E2E8F0', 
    borderWidth: 1, 
    borderRadius: 12, 
    paddingHorizontal: 16, 
    paddingVertical: 12,
    marginTop: 8,
    backgroundColor: '#F8FAFC',
    fontSize: 16,
  },
  footerStyle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 32,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.APP_RED,
    height: 50,
  },
  sendButton: {
    flex: 1,
    backgroundColor: Colors.APP_RED,
    height: 50,
  }
});

export default DirectMessageBottomSheet;

