import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { theme } from '../theme';
import { useAuth } from '../store/useAuth';
import type { RootStackParamList } from './types';

import { EnrollmentScreen } from '../screens/EnrollmentScreen';
import { ProfileSelectScreen } from '../screens/ProfileSelectScreen';
import { UnlockScreen } from '../screens/UnlockScreen';
import { PinScreen } from '../screens/PinScreen';
import { OpenSessionScreen } from '../screens/OpenSessionScreen';
import { CloseSessionScreen } from '../screens/CloseSessionScreen';
import { RoomsScreen } from '../screens/RoomsScreen';
import { ComptoirScreen } from '../screens/ComptoirScreen';
import { PosScreen } from '../screens/PosScreen';
import { CartScreen } from '../screens/CartScreen';
import { PaymentScreen } from '../screens/PaymentScreen';
import { SplitScreen } from '../screens/SplitScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
    const enrolled = useAuth((s) => s.enrolled);
    const profileId = useAuth((s) => s.profileId);

    return (
        <Stack.Navigator
            screenOptions={{
                headerStyle: { backgroundColor: theme.colors.bgElevated },
                headerShadowVisible: false,
                headerTintColor: theme.colors.text,
                headerTitleStyle: { fontWeight: '800', fontSize: 18 },
                headerTitleAlign: 'center',
                contentStyle: { backgroundColor: theme.colors.bg },
            }}
        >
            {!enrolled ? (
                <Stack.Screen name="Enrollment" component={EnrollmentScreen} options={{ headerShown: false }} />
            ) : !profileId ? (
                <Stack.Screen name="ProfileSelect" component={ProfileSelectScreen} options={{ headerShown: false }} />
            ) : (
                <>
                    <Stack.Screen name="Unlock" component={UnlockScreen} options={{ headerShown: false }} />
                    <Stack.Screen name="Pin" component={PinScreen} options={{ title: 'Code PIN' }} />
                    <Stack.Screen name="OpenSession" component={OpenSessionScreen} options={{ title: 'Ouverture de caisse' }} />
                    <Stack.Screen name="CloseSession" component={CloseSessionScreen} options={{ title: 'Fermeture de caisse' }} />
                    <Stack.Screen name="Rooms" component={RoomsScreen} options={{ headerShown: false }} />
                    <Stack.Screen name="Comptoir" component={ComptoirScreen} options={{ headerShown: false }} />
                    <Stack.Screen name="Pos" component={PosScreen} options={{ title: 'Commande' }} />
                    <Stack.Screen name="Cart" component={CartScreen} options={{ title: 'Panier' }} />
                    <Stack.Screen name="Payment" component={PaymentScreen} options={{ title: 'Paiement' }} />
                    <Stack.Screen name="Split" component={SplitScreen} options={{ title: "Partager l'addition" }} />
                </>
            )}
        </Stack.Navigator>
    );
}
