import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useState, useEffect } from 'react';
import { router, Stack } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  ArrowLeft,
  Camera,
  Keyboard,
  FlashlightOff,
  Flashlight,
  X,
} from 'lucide-react-native';
import { api } from '@/lib/api';

type Mode = 'scan' | 'code';

export default function ScanPayScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('scan');
  const [torch, setTorch] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Manual code entry
  const [storeCode, setStoreCode] = useState('');
  const [lookingUp, setLookingUp] = useState(false);

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanned || processing) return;

    setScanned(true);
    setProcessing(true);

    try {
      // Parse the QR code data
      // Format: coop://pay/r/{token} or coop://pay/s/{code}
      // Or web URL: https://app.cahootz.coop/pay?r={token}

      let token: string | null = null;
      let code: string | null = null;

      if (data.startsWith('coop://pay/r/')) {
        token = data.replace('coop://pay/r/', '');
      } else if (data.startsWith('coop://pay/s/')) {
        code = data.replace('coop://pay/s/', '');
      } else if (data.includes('app.cahootz.coop/pay')) {
        const url = new URL(data);
        token = url.searchParams.get('r');
        if (!token) {
          code = url.searchParams.get('s');
        }
      } else {
        // Try treating it as a store code directly
        code = data.toUpperCase().replace(/[^A-Z0-9-]/g, '');
      }

      if (token) {
        // Navigate to quick pay with token
        router.replace({
          pathname: '/(authenticated)/quick-pay',
          params: { token },
        } as any);
      } else if (code) {
        // Validate the store code first
        const result = await api.getStoreByCode(code);
        if (result.found) {
          router.replace({
            pathname: '/(authenticated)/quick-pay',
            params: { code },
          } as any);
        } else {
          Alert.alert('Invalid QR Code', 'This QR code is not recognized as a valid payment code.');
          setScanned(false);
        }
      } else {
        Alert.alert('Invalid QR Code', 'This QR code is not a valid payment code.');
        setScanned(false);
      }
    } catch (err) {
      console.error('Error processing QR code:', err);
      Alert.alert('Error', 'Failed to process QR code. Please try again.');
      setScanned(false);
    } finally {
      setProcessing(false);
    }
  };

  const handleLookupCode = async () => {
    if (!storeCode.trim() || lookingUp) return;

    setLookingUp(true);

    try {
      const result = await api.getStoreByCode(storeCode.trim());

      if (result.found) {
        router.replace({
          pathname: '/(authenticated)/quick-pay',
          params: { code: storeCode.trim().toUpperCase() },
        } as any);
      } else {
        Alert.alert('Store Not Found', 'No store found with this code. Please check and try again.');
      }
    } catch (err) {
      console.error('Error looking up store:', err);
      Alert.alert('Error', 'Failed to look up store. Please try again.');
    } finally {
      setLookingUp(false);
    }
  };

  // Permission handling
  if (!permission) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <ActivityIndicator size="large" color="white" />
      </View>
    );
  }

  if (!permission.granted && mode === 'scan') {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View className="flex-1 bg-gray-900">
          <View className="pt-14 pb-4 px-4">
            <View className="flex-row items-center">
              <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
                <ArrowLeft size={24} color="white" />
              </TouchableOpacity>
              <Text className="flex-1 text-center text-lg font-semibold text-white">
                Scan to Pay
              </Text>
              <View className="w-10" />
            </View>
          </View>

          <View className="flex-1 items-center justify-center p-8">
            <Camera size={64} color="#6B7280" />
            <Text className="text-white text-xl font-semibold mt-6 text-center">
              Camera Permission Needed
            </Text>
            <Text className="text-gray-400 text-center mt-2 mb-6">
              We need access to your camera to scan payment QR codes
            </Text>
            <TouchableOpacity
              onPress={requestPermission}
              className="bg-amber-600 px-6 py-3 rounded-xl"
            >
              <Text className="text-white font-semibold">Grant Permission</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setMode('code')}
              className="mt-4 px-6 py-3"
            >
              <Text className="text-amber-500 font-semibold">Enter Code Manually</Text>
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-gray-900">
        {/* Header */}
        <View className="pt-14 pb-4 px-4 absolute top-0 left-0 right-0 z-10">
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={() => router.back()}
              className="p-2 -ml-2 bg-black/30 rounded-full"
            >
              <ArrowLeft size={24} color="white" />
            </TouchableOpacity>
            <Text className="flex-1 text-center text-lg font-semibold text-white">
              {mode === 'scan' ? 'Scan to Pay' : 'Enter Store Code'}
            </Text>
            <View className="w-10" />
          </View>
        </View>

        {mode === 'scan' ? (
          <>
            {/* Camera View */}
            <CameraView
              style={StyleSheet.absoluteFillObject}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            />

            {/* Overlay */}
            <View className="flex-1 items-center justify-center">
              {/* Scanning Frame */}
              <View className="w-64 h-64 border-2 border-white rounded-3xl">
                {/* Corner decorations */}
                <View className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-amber-500 rounded-tl-xl" />
                <View className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-amber-500 rounded-tr-xl" />
                <View className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-amber-500 rounded-bl-xl" />
                <View className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-amber-500 rounded-br-xl" />
              </View>

              {processing && (
                <View className="absolute bg-black/50 rounded-xl px-6 py-4">
                  <ActivityIndicator size="small" color="white" />
                  <Text className="text-white mt-2">Processing...</Text>
                </View>
              )}
            </View>

            {/* Bottom Controls */}
            <View className="absolute bottom-0 left-0 right-0 pb-12 pt-6 px-4">
              <Text className="text-white text-center mb-6">
                Point your camera at a store&apos;s QR code
              </Text>

              <View className="flex-row justify-center items-center gap-6">
                {/* Torch Toggle */}
                <TouchableOpacity
                  onPress={() => setTorch(!torch)}
                  className="p-4 bg-white/20 rounded-full"
                >
                  {torch ? (
                    <Flashlight size={24} color="#FCD34D" />
                  ) : (
                    <FlashlightOff size={24} color="white" />
                  )}
                </TouchableOpacity>

                {/* Manual Entry */}
                <TouchableOpacity
                  onPress={() => setMode('code')}
                  className="p-4 bg-white/20 rounded-full"
                >
                  <Keyboard size={24} color="white" />
                </TouchableOpacity>
              </View>

              {scanned && !processing && (
                <TouchableOpacity
                  onPress={() => setScanned(false)}
                  className="mt-4 py-3 items-center"
                >
                  <Text className="text-amber-500 font-semibold">Scan Again</Text>
                </TouchableOpacity>
              )}
            </View>
          </>
        ) : (
          /* Manual Code Entry */
          <View className="flex-1 pt-24 px-4">
            <View className="bg-gray-800 rounded-2xl p-6">
              <Text className="text-white text-lg font-semibold mb-4">
                Enter Store Code
              </Text>

              <TextInput
                className="bg-gray-700 rounded-xl px-4 py-4 text-white text-lg font-mono text-center"
                placeholder="e.g., JOES-COFFEE"
                placeholderTextColor="#6B7280"
                value={storeCode}
                onChangeText={(text) => setStoreCode(text.toUpperCase())}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={20}
              />

              <TouchableOpacity
                onPress={handleLookupCode}
                disabled={!storeCode.trim() || lookingUp}
                className={`mt-4 py-4 rounded-xl items-center ${
                  storeCode.trim() && !lookingUp ? 'bg-amber-600' : 'bg-gray-600'
                }`}
              >
                {lookingUp ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text className="text-white font-bold text-lg">Look Up Store</Text>
                )}
              </TouchableOpacity>

              {permission.granted && (
                <TouchableOpacity
                  onPress={() => setMode('scan')}
                  className="mt-4 py-3 items-center flex-row justify-center"
                >
                  <Camera size={20} color="#F59E0B" />
                  <Text className="text-amber-500 font-semibold ml-2">Scan QR Code Instead</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </View>
    </>
  );
}
