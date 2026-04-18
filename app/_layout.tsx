import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { View, ActivityIndicator } from 'react-native';

function RootLayoutNav() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!user) {
    return (
      <Stack>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="register" options={{ headerShown: false }} />
      </Stack>
    );
  }

  return (
  <Stack>
    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
    <Stack.Screen name="add-property" options={{ title: 'Add Property' }} />
    <Stack.Screen name="tenant-details" options={{ title: 'Tenant Details' }} />
    <Stack.Screen name="auto-rent" options={{ title: 'Auto Rent' }} />
    <Stack.Screen name="unmatched-payments" options={{ title: 'Unmatched Payments' }} />
    <Stack.Screen name="reports" options={{ title: 'Reports' }} />
  </Stack>
);
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
      <StatusBar style="auto" />
    </AuthProvider>
  );
}