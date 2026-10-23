import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { api } from '~/lib/api';
import { friendlyError } from '~/lib/friendly-error';
import { useAuth } from '@/contexts/auth-context';
import { storeLocalWalletPrivateKey } from '@/lib/mobile-wallet';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { keyboardInsetScrollProps } from '@/lib/keyboard';

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
      Alert.alert('Password needed', 'Enter your password to continue.');
      return;
    }

    if (!user?.id || !user.walletAddress) {
      Alert.alert("Couldn't find your wallet", 'Sign out, sign in again, and then try again.');
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
      } else {
        Alert.alert("Couldn't export your wallet", "We couldn't export your wallet. Please try again.");
      }
    } catch (err) {
      console.error('Export wallet failed:', err);
      Alert.alert("Couldn't export your wallet", friendlyError(err, "We couldn't export your wallet."));
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', `${label} copied`);
  };

  if (step === 'warning') {
    return (
      <ScrollView className="flex-1 bg-gray-50">
        <View className="p-6">
          <Text className="text-2xl font-bold text-gray-900 mb-4">
            ⚠️ Before you go on
          </Text>

          <View className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <Text className="text-red-800 font-semibold mb-2">
              Keep this safe
            </Text>
            <Text className="text-red-700 text-sm leading-6">
              Your private key works like a master password for your money. It gives full access to your wallet and everything in it. Anyone who has it can take your money.
            </Text>
          </View>

          <View className="bg-white rounded-xl p-4 mb-6 space-y-4">
            <Text className="text-gray-900 font-semibold mb-2">Remember:</Text>

            <View className="flex-row">
              <Text className="text-gray-600 mr-2">•</Text>
              <Text className="flex-1 text-gray-700">
                Never share your private key with anyone
              </Text>
            </View>

            <View className="flex-row">
              <Text className="text-gray-600 mr-2">•</Text>
              <Text className="flex-1 text-gray-700">
                Keep it somewhere safe, like a password manager, a hardware wallet, or a paper copy in a safe
              </Text>
            </View>

            <View className="flex-row">
              <Text className="text-gray-600 mr-2">•</Text>
              <Text className="flex-1 text-gray-700">
                Don&apos;t take a screenshot of it or save it in cloud storage
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
                If you lose your private key, you lose access to your money
              </Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => setUnderstood(!understood)}
            className="flex-row items-center mb-6"
          >
            <View className={`w-6 h-6 border-2 rounded mr-3 items-center justify-center ${
              understood ? 'bg-primary border-amber-600' : 'border-gray-400'
            }`}>
              {understood && <Text className="text-white font-bold">✓</Text>}
            </View>
            <Text className="flex-1 text-gray-700">
              I get the risks, and I&apos;ll keep my private key safe
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setStep('password')}
            disabled={!understood}
            className={`py-4 rounded-xl items-center mb-3 ${
              understood ? 'bg-primary' : 'bg-gray-300'
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
      <ScrollView {...keyboardInsetScrollProps} className="flex-1 bg-gray-50">
        <View className="p-6">
          <Text className="text-2xl font-bold text-gray-900 mb-2">
            Make sure it&apos;s you
          </Text>
          <Text className="text-gray-600 mb-6">
            Enter your password to set up this phone to sign for your wallet. We&apos;ll keep your key in your phone&apos;s secure storage.
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
              loading || !password ? 'bg-gray-300' : 'bg-primary'
            }`}
          >
            {loading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Text className="text-white font-bold text-lg">Show my private key</Text>
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
          This phone is set up
        </Text>
        <Text className="text-gray-600 mb-6">
          This phone can now sign for your Cahootz wallet. If you want a backup somewhere else too, save the info below somewhere safe.
        </Text>

        {/* Wallet Address */}
        <View className="bg-white rounded-xl p-4 mb-4">
          <Text className="text-gray-700 font-semibold mb-2">Wallet address</Text>
          <Text className="text-gray-900 font-mono text-sm mb-3 break-all">
            {walletAddress}
          </Text>
          <TouchableOpacity
            onPress={() => copyToClipboard(walletAddress, 'Address')}
            className="bg-primary py-2 rounded-lg items-center"
          >
            <Text className="text-white font-semibold">Copy address</Text>
          </TouchableOpacity>
        </View>

        {/* Private Key */}
        <View className="bg-white rounded-xl p-4 mb-4">
          <Text className="text-gray-700 font-semibold mb-2">Private key</Text>
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
              className="bg-primary py-2 rounded-lg items-center"
            >
              <Text className="text-white font-semibold">Copy private key</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* QR Code */}
        {showKey && (
          <View className="bg-white rounded-xl p-4 mb-4 items-center">
            <Text className="text-gray-700 font-semibold mb-3">QR code</Text>
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
          <Text className="text-red-800 font-semibold mb-2">⚠️ One last thing</Text>
          <Text className="text-red-700 text-sm">
            Once you close this screen, you&apos;ll need to enter your password again to see your private key. Make sure you&apos;ve saved it somewhere safe.
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => {
            Alert.alert(
              'Saved it?',
              'Have you saved your private key somewhere safe?',
              [
                { text: 'Not yet', style: 'cancel' },
                {
                  text: "Yes, I saved it",
                  onPress: () => router.back(),
                },
              ]
            );
          }}
          className="bg-primary py-4 rounded-xl items-center"
        >
          <Text className="text-white font-bold text-lg">Done</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
