import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface PaymentConfirmationModalProps {
  visible: boolean;
  amount: string;
  processorFee?: number;
  fromBalance?: number;
  fromCard?: number;
  total?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PaymentConfirmationModal({
  visible,
  amount,
  processorFee,
  fromBalance,
  fromCard,
  total,
  onConfirm,
  onCancel,
}: PaymentConfirmationModalProps) {
  const hasFeeBreakdown = processorFee !== undefined && processorFee > 0;
  const hasPartialPayment = fromBalance !== undefined && fromBalance > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.title}>Confirm Payment</Text>
          <Text style={styles.amount}>{amount}</Text>

          {hasFeeBreakdown && (
            <View style={styles.feeBreakdown}>
              {hasPartialPayment && (
                <>
                  <View style={styles.feeRow}>
                    <Text style={styles.feeLabel}>From wallet:</Text>
                    <Text style={styles.feeValue}>-${fromBalance!.toFixed(2)}</Text>
                  </View>
                  <View style={styles.feeRow}>
                    <Text style={styles.feeLabel}>From card:</Text>
                    <Text style={styles.feeValue}>${fromCard!.toFixed(2)}</Text>
                  </View>
                </>
              )}
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Processing fee:</Text>
                <Text style={styles.feeValue}>${processorFee.toFixed(2)}</Text>
              </View>
              <View style={[styles.feeRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>
                  {hasPartialPayment ? 'Card charge:' : 'Total:'}
                </Text>
                <Text style={styles.totalValue}>
                  ${(total || parseFloat(amount.replace(/[^0-9.]/g, '')) + processorFee).toFixed(2)}
                </Text>
              </View>
            </View>
          )}

          <Text style={styles.message}>
            {hasFeeBreakdown
              ? 'Review the breakdown and confirm to proceed.'
              : 'Tap Confirm to make this payment, or Cancel to go back.'}
          </Text>

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={onCancel}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.confirmButton]}
              onPress={onConfirm}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Text style={styles.confirmButtonText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 16,
    textAlign: 'center',
  },
  amount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#3b82f6',
    marginBottom: 12,
    textAlign: 'center',
  },
  feeBreakdown: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  feeLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  feeValue: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  totalRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  totalLabel: {
    fontSize: 15,
    color: '#1f2937',
    fontWeight: '600',
  },
  totalValue: {
    fontSize: 16,
    color: '#1f2937',
    fontWeight: '700',
  },
  message: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 20,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#f3f4f6',
  },
  confirmButton: {
    backgroundColor: '#3b82f6',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
});
