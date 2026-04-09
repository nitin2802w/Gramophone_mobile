import React, { useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';

import { PlayerProvider } from './src/context/PlayerContext';
import { DownloadProvider } from './src/context/DownloadContext';

import WelcomeScreen  from './src/screens/WelcomeScreen';
import PlayerScreen   from './src/screens/PlayerScreen';
import LibraryScreen  from './src/screens/LibraryScreen';
import DownloadScreen from './src/screens/Downloadscreen';
import SettingsScreen from './src/screens/Settingscreen';
import MiniPlayer     from './src/components/MiniPlayer';

const Stack = createStackNavigator();

const screenOptions = {
  headerShown: false,
  cardStyle:   { backgroundColor: '#0d0d14' },
};

function AppContent({ currentRoute }) {
  return (
    <>
      <StatusBar style="light" />
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen name="Welcome"  component={WelcomeScreen}  />
        <Stack.Screen name="Main"     component={PlayerScreen}   />
        <Stack.Screen name="Library"  component={LibraryScreen}  />
        <Stack.Screen name="Download" component={DownloadScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
      {currentRoute !== 'Welcome' && currentRoute !== 'Main' && <MiniPlayer />}
    </>
  );
}

export default function App() {
  const [currentRoute, setCurrentRoute] = useState('Welcome');

  return (
    <PlayerProvider>
      <DownloadProvider>
        <NavigationContainer
          onStateChange={(state) => {
            if (state) {
              const route = state.routes[state.index].name;
              setCurrentRoute(route);
            }
          }}
        >
          <AppContent currentRoute={currentRoute} />
        </NavigationContainer>
      </DownloadProvider>
    </PlayerProvider>
  );
}