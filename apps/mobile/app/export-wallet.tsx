import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { api } from '~/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { storeLocalWalletPrivateKey } from '@/lib/mobile-wallet';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';

export default function ExportWalletScreen() {
  const [step, setStep] = useState<'warning' | 'password' | 'display'>('warning');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [privateKey, setPrivateKey] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const { user } = useAuth();

  const handleExport = async () => {
    if (!password.trim()) {
      Alert.alert('Error', 'Please enter your password');
      return;
    }

    if (!user?.id || !user.walletAddress) {
      Alert.alert('Error', 'Wallet not found. Please sign in again.');
      return;
    }

    setLoading(true);
    try {
      const walletData = await api.exportWallet(user.id, password, user.walletAddress);

      if (walletData) {
        await storeLocalWalletPrivateKey(user.id, walletData.address, walletData.privateKey);
        setPrivateKey(walletData.privateKey);
        setWalletAddress(walletData.address);
        setStep('display');
      }
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to export wallet');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', `${label} copied to clipboard`);
  };

  if (step === 'warning') {
    return (
      <ScrollView className="flex-1 bg-gray-50">
        <View className="p-6">
          <Text className="text-2xl font-bold text-gray-900 mb-4">
            ⚠️ Security Warning
          </Text>

          <View className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <Text className="text-red-800 font-semibold mb-2">
              Critical Security Information
            </Text>
            <Text className="text-red-700 text-sm leading-6">
              Your private key gives complete access to your wallet and funds. Anyone who has your private key can steal your funds.
            </Text>
          </View>

          <View className="bg-white rounded-xl p-4 mb-6 space-y-4">
            <Text className="text-gray-900 font-semibold mb-2">Important:</Text>

            <View className="flex-row">
              <Text className="text-gray-600 mr-2">•</Text>
              <Text className="flex-1 text-gray-700">
                Never share your private key with anyone
              </Text>
            </View>

            <View className="flex-row">
              <Text className="text-gray-600 mr-2">•</Text>
              <Text className="flex-1 text-gray-700">
                Store it in a secure location (password manager, hardware wallet, or paper backup in a safe)
              </Text>
            </View>

            <View className="flex-row">
              <Text className="text-gray-600 mr-2">•</Text>
              <Text className="flex-1 text-gray-700">
                Do not take screenshots or save it in cloud storage
              </Text>
            </View>

            <View className="flex-row">
              <Text className="text-gray-600 mr-2">•</Text>
              <Text className="flex-1 text-gray-700">
                Cahootz will never ask you for your private key
              </Text>
            </View>

            <View className="flex-row">
              <Text className="text-gray-600 mr-2">•</Text>
              <Text className="flex-1 text-gray-700">
                If you lose your private key, you will lose access to your funds
              </Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => setUnderstood(!understood)}
            className="flex-row items-center mb-6"
          >
            <View className={`w-6 h-6 border-2 rounded mr-3 items-center justify-center ${
              understood ? 'bg-amber-600 border-amber-600' : 'border-gray-400'
            }`}>
              {understood && <Text className="text-white font-bold">✓</Text>}
            </View>
            <Text className="flex-1 text-gray-700">
              I understand the risks and will store my private key securely
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setStep('password')}
            disabled={!understood}
            className={`py-4 rounded-xl items-center mb-3 ${
              understood ? 'bg-amber-600' : 'bg-gray-300'
            }`}
          >
            <Text className="text-white font-bold text-lg">Continue</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.back()}
            className="py-4 rounded-xl items-center bg-gray-200"
          >
            <Text className="text-gray-700 font-semibold">Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  if (step === 'password') {
    return (
      <ScrollView className="flex-1 bg-gray-50">
        <View className="p-6">
          <Text className="text-2xl font-bold text-gray-900 mb-2">
            Verify Your Identity
          </Text>
          <Text className="text-gray-600 mb-6">
            Enter your password to enable wallet signing on this device. Your key will be stored in secure device storage.
          </Text>

          <View className="bg-white rounded-xl p-4 mb-6">
            <Text className="text-gray-700 font-medium mb-2">Password</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 text-gray-900"
              placeholder="Enter your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <TouchableOpacity
            onPress={handleExport}
            disabled={loading || !password}
            className={`py-4 rounded-xl items-center mb-3 ${
              loading || !password ? 'bg-gray-300' : 'bg-amber-600'
            }`}
          >
            {loading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text className="text-white font-bold text-lg">Export Private Key</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setStep('warning')}
            className="py-4 rounded-xl items-center bg-gray-200"
          >
            <Text className="text-gray-700 font-semibold">Back</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // Display step
  return (
    <ScrollView className="flex-1 bg-gray-50">
      <View className="p-6">
        <Text className="text-2xl font-bold text-gray-900 mb-2">
          Wallet Signing Enabled
        </Text>
        <Text className="text-gray-600 mb-6">
          This device can now sign Cahootz wallet verification messages. Save this information securely if you also want an external backup.
        </Text>

        {/* Wallet Address */}
        <View className="bg-white rounded-xl p-4 mb-4">
          <Text className="text-gray-700 font-semibold mb-2">Wallet Address</Text>
          <Text className="text-gray-900 font-mono text-sm mb-3 break-all">
            {walletAddress}
          </Text>
          <TouchableOpacity
            onPress={() => copyToClipboard(walletAddress, 'Address')}
            className="bg-amber-600 py-2 rounded-lg items-center"
          >
            <Text className="text-white font-semibold">Copy Address</Text>
          </TouchableOpacity>
        </View>

        {/* Private Key */}
        <View className="bg-white rounded-xl p-4 mb-4">
          <Text className="text-gray-700 font-semibold mb-2">Private Key</Text>
          <TouchableOpacity onPress={() => setShowKey(!showKey)} className="mb-3">
            <View className={`p-3 rounded-lg ${showKey ? 'bg-gray-100' : 'bg-yellow-50'}`}>
              {showKey ? (
                <Text className="text-gray-900 font-mono text-xs break-all">
                  {privateKey}
                </Text>
              ) : (
                <View className="items-center py-2">
                  <Text className="text-yellow-800 font-medium">
                    Tap to reveal private key
                  </Text>
                  <Text className="text-yellow-600 text-xs mt-1">
                    Make sure no one is watching
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>

          {showKey && (
            <TouchableOpacity
              onPress={() => copyToClipboard(privateKey, 'Private key')}
              className="bg-amber-600 py-2 rounded-lg items-center"
            >
              <Text className="text-white font-semibold">Copy Private Key</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* QR Code */}
        {showKey && (
          <View className="bg-white rounded-xl p-4 mb-4 items-center">
            <Text className="text-gray-700 font-semibold mb-3">QR Code</Text>
            <QRCode
              value={privateKey}
              size={200}
              backgroundColor="white"
              color="black"
            />
            <Text className="text-xs text-gray-500 text-center mt-3">
              Scan this with a wallet app to import
            </Text>
          </View>
        )}

        {/* Warning */}
        <View className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <Text className="text-red-800 font-semibold mb-2">⚠️ Final Warning</Text>
          <Text className="text-red-700 text-sm">
            Once you close this screen, you won&apos;t be able to see your private key again without re-authenticating. Make sure you&apos;ve saved it securely.
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => {
            Alert.alert(
              'Confirm',
              'Have you saved your private key securely?',
              [
                { text: 'Not Yet', style: 'cancel' },
                {
                  text: "Yes, I've Saved It",
                  onPress: () => router.back(),
                },
              ]
            );
          }}
          className="bg-amber-600 py-4 rounded-xl items-center"
        >
          <Text className="text-white font-bold text-lg">Done</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
