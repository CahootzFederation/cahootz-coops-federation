import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { CameraView, Camera } from 'expo-camera';
import { isAddress } from 'viem';

interface QRScannerProps {
  onScan: (address: string) => void;
  onClose: () => void;
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;

    setScanned(true);

    // Extract address from various QR code formats
    let address = data;

    // Handle ethereum: URI scheme
    if (data.startsWith('ethereum:')) {
      address = data.replace('ethereum:', '').split('@')[0].split('?')[0];
    }

    // Validate Ethereum address
    if (isAddress(address)) {
      onScan(address);
      onClose();
    } else {
      Alert.alert(
        'Invalid QR Code',
        'The scanned QR code does not contain a valid Ethereum address.',
        [
          {
            text: 'Try Again',
            onPress: () => setScanned(false),
          },
          {
            text: 'Cancel',
            onPress: onClose,
            style: 'cancel',
          },
        ]
      );
    }
  };

  if (hasPermission === null) {
    return (
      <View className="flex-1 items-center justify-center bg-black">
        <Text className="text-white">Requesting camera permission...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View className="flex-1 items-center justify-center bg-black px-6">
        <Text className="text-white text-center mb-4">
          Camera permission is required to scan QR codes
        </Text>
        <TouchableOpacity
          onPress={async () => {
            const { status } = await Camera.requestCameraPermissionsAsync();
            setHasPermission(status === 'granted');
          }}
          className="bg-primary px-6 py-3 rounded-lg"
        >
          <Text className="text-white font-semibold">Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} className="mt-4">
          <Text className="text-gray-400">Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <CameraView
        style={StyleSheet.absoluteFillObject}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
      />

      {/* Overlay */}
      <View className="flex-1 justify-center items-center">
        {/* Top overlay */}
        <View className="absolute top-0 left-0 right-0 h-1/4 bg-black/50" />

        {/* Side overlays */}
        <View className="flex-row w-full h-1/2">
          <View className="flex-1 bg-black/50" />
          <View className="w-64 h-64 border-2 border-white rounded-lg" />
          <View className="flex-1 bg-black/50" />
        </View>

        {/* Bottom overlay */}
        <View className="absolute bottom-0 left-0 right-0 h-1/4 bg-black/50 items-center justify-center">
          <Text className="text-white text-center mb-4 px-6">
            Scan a wallet address QR code
          </Text>
          <TouchableOpacity
            onPress={onClose}
            className="bg-gray-700 px-6 py-3 rounded-lg"
          >
            <Text className="text-white font-semibold">Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
