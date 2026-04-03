import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Modal, FlatList } from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { db, tenantsCollection, paymentsCollection, unmatchedPaymentsCollection } from '../../lib/firebase';
import { collection, getDocs, addDoc, query, where, Timestamp, doc, updateDoc } from 'firebase/firestore';

type Tenant = {
  id: string;
  name: string;
  phone: string;
  propertyName?: string;
  room: string;
  roomCode: string;
  monthlyRent: number;
  balance: number;
  userId?: string;
};

type PaymentMethod = 'mpesa' | 'manual' | 'whatsapp';

export default function PaymentsScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [filteredTenants, setFilteredTenants] = useState<Tenant[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('manual');
  const [mpesaCode, setMpesaCode] = useState('');
  const [mpesaText, setMpesaText] = useState('');
  const [showTenantSelector, setShowTenantSelector] = useState(false);
  const [showTestSMS, setShowTestSMS] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (userId) {
      loadTenants();
    }
  }, [userId]);

  useEffect(() => {
    if (searchQuery) {
      const filtered = tenants.filter(tenant => 
        tenant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tenant.roomCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tenant.phone.includes(searchQuery)
      );
      setFilteredTenants(filtered);
    } else {
      setFilteredTenants(tenants);
    }
  }, [searchQuery, tenants]);

  const loadTenants = async () => {
    if (!userId) return;
    try {
      const q = query(tenantsCollection, where('userId', '==', userId));
      const tenantsSnapshot = await getDocs(q);
      const tenantsList: Tenant[] = [];
      tenantsSnapshot.forEach((doc) => {
        const data = doc.data();
        tenantsList.push({
          id: doc.id,
          name: data.name,
          phone: data.phone,
          room: data.room,
          roomCode: data.roomCode,
          monthlyRent: data.monthlyRent,
          balance: data.balance || 0,
        });
      });
      setTenants(tenantsList);
      setFilteredTenants(tenantsList);
    } catch (error) {
      console.error('Error loading tenants:', error);
      Alert.alert('Error', 'Failed to load tenants');
    }
  };

  const parseMpesaSMS = (text: string) => {
    console.log('Parsing SMS:', text);
    
    // Extract transaction code
    const codeMatch = text.match(/^([A-Z0-9]{10,12})\s/);
    if (codeMatch) {
      setMpesaCode(codeMatch[1]);
    }
    
    // Extract amount
    const amountMatch = text.match(/(?:Ksh|KES)\s?([\d,]+(?:\.\d{2})?)/i);
    if (amountMatch) {
      const extractedAmount = amountMatch[1].replace(/,/g, '');
      setAmount(extractedAmount);
    }
    
    // Try to find tenant (but don't show alert if not found)
    const accountMatch = text.match(/account\s([A-Z0-9#]+)/i);
    if (accountMatch) {
      const accountRef = accountMatch[1];
      const roomMatch = accountRef.match(/#[A-Z]+(\d{2})$/i);
      if (roomMatch) {
        const roomNumber = roomMatch[1];
        const tenant = tenants.find(t => {
          const tenantRoomDigits = t.room.replace(/[^0-9]/g, '');
          return tenantRoomDigits === roomNumber || t.room === roomNumber;
        });
        
        if (tenant) {
          setSelectedTenant(tenant);
          Alert.alert('Tenant Found', `Matched: ${tenant.name}\nRoom: ${tenant.room}`);
        }
      }
    }
    
    // Show extracted data summary
    let summary = '';
    if (mpesaCode) summary += `Code: ${mpesaCode}\n`;
    if (amountMatch) summary += `Amount: KES ${amountMatch[1]}\n`;
    
    if (summary) {
      Alert.alert('Extracted Details', summary);
    }
  };

  const handleMpesaPaste = () => {
    if (!mpesaText.trim()) {
      Alert.alert('Error', 'Please paste the M-Pesa SMS');
      return;
    }
    parseMpesaSMS(mpesaText);
  };

  const handleRecordPayment = async () => {
    console.log('=== RECORD PAYMENT CLICKED ===');
    console.log('Amount:', amount);
    console.log('Selected Tenant:', selectedTenant?.name || 'None');
    console.log('Payment Method:', paymentMethod);
    console.log('Has mpesaText:', !!mpesaText);
    
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    setIsLoading(true);
    try {
      const paymentAmount = parseFloat(amount);
      
      // CASE 1: Tenant is selected
      if (selectedTenant) {
        console.log('CASE 1: Normal payment with tenant');
        const newBalance = selectedTenant.balance - paymentAmount;
        
        await addDoc(paymentsCollection, {
          tenantId: selectedTenant.id,
          tenantName: selectedTenant.name,
          roomCode: selectedTenant.roomCode,
          amount: paymentAmount,
          date: Timestamp.now(),
          source: paymentMethod,
          transactionCode: paymentMethod === 'mpesa' ? mpesaCode || null : null,
          originalText: paymentMethod === 'mpesa' ? mpesaText : null,
          userId: userId,
        });
        
        const tenantRef = doc(db, 'tenants', selectedTenant.id);
        await updateDoc(tenantRef, {
          balance: newBalance,
          lastPaymentDate: Timestamp.now(),
        });
        
        Alert.alert('Success', `Payment recorded! New Balance: KES ${newBalance.toLocaleString()}`);
        resetForm();
        loadTenants();
      } 
      // CASE 2: No tenant but have SMS - Save to Unmatched
      else if (paymentMethod === 'mpesa' && mpesaText) {
        console.log('CASE 2: No tenant found, saving to unmatched');
        
        // Extract room number
        let extractedRoom = null;
        const accountMatch = mpesaText.match(/account\s([A-Z0-9#]+)/i);
        if (accountMatch) {
          const roomMatch = accountMatch[1].match(/#[A-Z]+(\d{2})$/i);
          if (roomMatch) {
            extractedRoom = roomMatch[1];
          }
        }
        
        const phoneMatch = mpesaText.match(/(07\d{8})/);
        
        await addDoc(unmatchedPaymentsCollection, {
          originalText: mpesaText,
          amount: paymentAmount,
          transactionCode: mpesaCode || null,
          phone: phoneMatch ? phoneMatch[0] : null,
          extractedRoom: extractedRoom,
          date: Timestamp.now(),
          status: 'pending',
          userId: userId,
        });
        
        console.log('Saved to unmatched successfully');
        Alert.alert(
          'Unmatched Payment Saved', 
          `Payment of KES ${paymentAmount.toLocaleString()} saved to Unmatched Payments.\n\nGo to the Unmatched Payments screen (⚠️ icon) to assign it manually.`
        );
        resetForm();
      } 
      else {
        console.log('CASE 3: No conditions met');
        Alert.alert('Error', 'Please select a tenant or paste a valid SMS');
      }
    } catch (error) {
      console.error('Error:', error);
      Alert.alert('Error', 'Failed: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setSelectedTenant(null);
    setAmount('');
    setPaymentMethod('manual');
    setMpesaCode('');
    setMpesaText('');
    setSearchQuery('');
  };

  const renderTenantItem = ({ item }: { item: Tenant }) => (
    <TouchableOpacity 
      style={styles.tenantItem}
      onPress={() => {
        setSelectedTenant(item);
        setShowTenantSelector(false);
      }}
    >
      <Text style={styles.tenantItemName}>{item.name}</Text>
      <Text style={styles.tenantItemDetails}>{item.roomCode} • KES {item.monthlyRent.toLocaleString()}</Text>
      <Text style={[styles.tenantItemBalance, item.balance > 0 ? styles.balanceDue : styles.balancePaid]}>
        Balance: KES {item.balance.toLocaleString()}
      </Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Record Payment</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tenant Selection */}
      <View style={styles.card}>
        <Text style={styles.label}>Select Tenant *</Text>
        <TouchableOpacity 
          style={styles.selectorButton}
          onPress={() => setShowTenantSelector(true)}
        >
          <Text style={styles.selectorText}>
            {selectedTenant ? `${selectedTenant.name} (${selectedTenant.roomCode})` : 'Choose a tenant'}
          </Text>
        </TouchableOpacity>
        
        {selectedTenant && (
          <View style={styles.selectedInfo}>
            <Text style={styles.infoText}>Room: {selectedTenant.roomCode}</Text>
            <Text style={styles.infoText}>Current Balance: KES {selectedTenant.balance.toLocaleString()}</Text>
            <Text style={[styles.infoText, styles.rentText]}>
              Monthly Rent: KES {selectedTenant.monthlyRent.toLocaleString()}
            </Text>
          </View>
        )}
      </View>

      {/* Payment Method Tabs */}
      <View style={styles.card}>
        <Text style={styles.label}>Payment Method</Text>
        <View style={styles.tabContainer}>
          <TouchableOpacity 
            style={[styles.tab, paymentMethod === 'manual' && styles.activeTab]}
            onPress={() => setPaymentMethod('manual')}
          >
            <Text style={[styles.tabText, paymentMethod === 'manual' && styles.activeTabText]}>Manual</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tab, paymentMethod === 'mpesa' && styles.activeTab]}
            onPress={() => setPaymentMethod('mpesa')}
          >
            <Text style={[styles.tabText, paymentMethod === 'mpesa' && styles.activeTabText]}>M-Pesa SMS</Text>
          </TouchableOpacity>
        </View>

        {paymentMethod === 'manual' && (
          <View>
            <TextInput
              style={styles.input}
              placeholder="Amount (KES)"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
            />
          </View>
        )}

        {paymentMethod === 'mpesa' && (
          <View>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Paste M-Pesa SMS here..."
              value={mpesaText}
              onChangeText={setMpesaText}
              multiline
              numberOfLines={4}
            />
            <TouchableOpacity style={styles.parseButton} onPress={handleMpesaPaste}>
              <Text style={styles.parseButtonText}>Extract Details</Text>
            </TouchableOpacity>
            {amount && (
              <View style={styles.extractedInfo}>
                <Text style={styles.extractedText}>Amount: KES {amount}</Text>
                {mpesaCode && <Text style={styles.extractedText}>Code: {mpesaCode}</Text>}
              </View>
            )}
          </View>
        )}
      </View>

      {/* Record Button */}
      <TouchableOpacity 
        style={[styles.recordButton, (!amount) && styles.disabledButton]}
        onPress={handleRecordPayment}
        disabled={!amount || isLoading}
      >
        <Text style={styles.recordButtonText}>
          {isLoading ? 'Recording...' : 'Record Payment'}
        </Text>
      </TouchableOpacity>

      {/* Test SMS Button */}
      <TouchableOpacity 
        style={styles.testSMSButton}
        onPress={() => setShowTestSMS(true)}
      >
        <Text style={styles.testSMSButtonText}>📱 Test SMS Parser</Text>
      </TouchableOpacity>

      {/* Tenant Selector Modal */}
      <Modal visible={showTenantSelector} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Tenant</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name, room code, or phone..."
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            <FlatList
              data={filteredTenants}
              renderItem={renderTenantItem}
              keyExtractor={(item) => item.id}
              style={styles.tenantList}
            />
            <TouchableOpacity style={styles.closeButton} onPress={() => setShowTenantSelector(false)}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Test SMS Modal */}
      <Modal visible={showTestSMS} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '70%' }]}>
            <Text style={styles.modalTitle}>Test SMS Parser</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Paste your M-Pesa SMS here..."
              value={mpesaText}
              onChangeText={setMpesaText}
              multiline
              numberOfLines={5}
            />
            <TouchableOpacity style={styles.parseButton} onPress={() => {
              handleMpesaPaste();
              setShowTestSMS(false);
            }}>
              <Text style={styles.parseButtonText}>Parse SMS</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeButton} onPress={() => setShowTestSMS(false)}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#e0e0e0' },
  backButton: { padding: 5 },
  backText: { fontSize: 16, color: '#27ae60' },
  title: { fontSize: 18, fontWeight: 'bold', color: '#2c3e50' },
  card: { backgroundColor: 'white', borderRadius: 12, padding: 15, margin: 15, marginTop: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  label: { fontSize: 16, fontWeight: '600', color: '#2c3e50', marginBottom: 10 },
  selectorButton: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, backgroundColor: '#fff' },
  selectorText: { fontSize: 16, color: '#2c3e50' },
  selectedInfo: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#eee' },
  infoText: { fontSize: 14, color: '#7f8c8d', marginBottom: 4 },
  rentText: { fontWeight: '600', color: '#27ae60' },
  tabContainer: { flexDirection: 'row', marginBottom: 15 },
  tab: { flex: 1, padding: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: '#ddd' },
  activeTab: { borderBottomColor: '#27ae60' },
  tabText: { fontSize: 14, color: '#95a5a6' },
  activeTabText: { color: '#27ae60', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 12 },
  textArea: { height: 100, textAlignVertical: 'top' },
  parseButton: { backgroundColor: '#3498db', padding: 12, borderRadius: 8, alignItems: 'center', marginBottom: 12 },
  parseButtonText: { color: 'white', fontWeight: '600' },
  extractedInfo: { backgroundColor: '#e8f5e9', padding: 10, borderRadius: 8 },
  extractedText: { fontSize: 14, color: '#2c3e50' },
  recordButton: { backgroundColor: '#27ae60', margin: 15, padding: 15, borderRadius: 8, alignItems: 'center' },
  disabledButton: { backgroundColor: '#95a5a6' },
  recordButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  testSMSButton: { backgroundColor: '#3498db', margin: 15, marginTop: 0, padding: 12, borderRadius: 8, alignItems: 'center' },
  testSMSButtonText: { color: 'white', fontWeight: '600', fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: 'white', borderRadius: 12, padding: 20, width: '90%', maxHeight: '80%' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  searchInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, marginBottom: 15, fontSize: 16 },
  tenantList: { maxHeight: 400 },
  tenantItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  tenantItemName: { fontSize: 16, fontWeight: '600', color: '#2c3e50' },
  tenantItemDetails: { fontSize: 12, color: '#7f8c8d', marginTop: 2 },
  tenantItemBalance: { fontSize: 14, fontWeight: '500', marginTop: 4 },
  balanceDue: { color: '#e74c3c' },
  balancePaid: { color: '#27ae60' },
  closeButton: { marginTop: 15, padding: 12, alignItems: 'center', backgroundColor: '#ecf0f1', borderRadius: 8 },
  closeButtonText: { color: '#7f8c8d', fontWeight: '600' },
});