import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { theme } from '../theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'success';

export function Button({
    label,
    onPress,
    variant = 'primary',
    disabled,
    loading,
    style,
}: {
    label: string;
    onPress: () => void;
    variant?: Variant;
    disabled?: boolean;
    loading?: boolean;
    style?: ViewStyle;
}) {
    const isSecondary = variant === 'secondary';
    const bg = {
        primary: theme.colors.primary,
        secondary: theme.colors.surface,
        danger: theme.colors.danger,
        success: theme.colors.success,
    }[variant];
    const labelColor = isSecondary
        ? theme.colors.text
        : variant === 'primary'
            ? theme.colors.onPrimary // texte foncé sur bouton blanc
            : theme.colors.onAccent; // texte blanc sur danger / success

    return (
        <Pressable
            onPress={onPress}
            disabled={disabled || loading}
            style={({ pressed }) => [
                styles.btn,
                { backgroundColor: bg },
                isSecondary && styles.secondary,
                pressed && { transform: [{ scale: 0.985 }], opacity: 0.92 },
                disabled && styles.disabled,
                style,
            ]}
        >
            {loading ? (
                <ActivityIndicator color={labelColor} />
            ) : (
                <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    btn: {
        height: 54,
        borderRadius: theme.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: theme.spacing(5),
    },
    secondary: { borderWidth: 1, borderColor: theme.colors.borderStrong },
    disabled: { opacity: 0.45 },
    label: { fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
});
