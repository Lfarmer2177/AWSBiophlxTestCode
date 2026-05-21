// CustomButton.js

import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import Colors from '../../Theme/Colors';

const CustomButton = ({ title, onPress, buttonStyle, textStyle }) => {
  return (
    <TouchableOpacity
      style={[styles.button, buttonStyle]}
      onPress={onPress}
    >
      <Text style={[styles.text, textStyle]}>{title}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    backgroundColor: Colors.APP_WHITE, // Example background color
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10, // Border radius
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  text: {
    color: Colors.APP_RED, // Example text color
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default CustomButton;
