import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Share, ActivityIndicator } from 'react-native';
import { useState, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { db, tenantsCollection, paymentsCollection, propertiesCollection } from '../lib/firebase';
import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore';

type ReportData = {
  totalTenants: number;
  totalProperties: number;
  totalArrears: number;
  totalCollectedMonth: number;
  totalCollectedYear: number;
  rentBreakdown: { property: string; rent: number; arrears: number }[];
  topDefaulters: { name: string; roomCode: string; balance: number }[];
};

export default function ReportsScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [report, setReport] = useState<ReportData | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (userId) {
      loadReport();
    }
  }, [userId]);

  const loadReport = async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      // Get tenants for this landlord
      const tenantsQuery = query(tenantsCollection, where('userId', '==', userId));
      const tenantsSnapshot = await getDocs(tenantsQuery);
      const tenants = tenantsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Get properties for this landlord
      const propertiesQuery = query(propertiesCollection, where('userId', '==', userId));
      const propertiesSnapshot = await getDocs(propertiesQuery);
      const properties = propertiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Get all payments for this landlord (no date filter to avoid index)
      const paymentsQuery = query(
        paymentsCollection,
        where('userId', '==', userId)
      );
      const paymentsSnapshot = await getDocs(paymentsQuery);
      const allPayments = paymentsSnapshot.docs.map(doc => ({
        amount: doc.data().amount || 0,
        date: doc.data().date?.toDate() || new Date()
      }));

      // Calculate this month's total
      const now = new Date();
      const firstDayMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const totalCollectedMonth = allPayments
        .filter(p => p.date >= firstDayMonth)
        .reduce((sum, p) => sum + p.amount, 0);

      // Calculate this year's total
      const firstDayYear = new Date(now.getFullYear(), 0, 1);
      const totalCollectedYear = allPayments
        .filter(p => p.date >= firstDayYear)
        .reduce((sum, p) => sum + p.amount, 0);

      // Calculate total arrears
      const totalArrears = tenants.reduce((sum, t) => sum + ((t.balance || 0) > 0 ? (t.balance || 0) : 0), 0);

      // Rent breakdown by property
      const rentBreakdown = properties.map(prop => {
        const propTenants = tenants.filter(t => t.propertyId === prop.id && t.status === 'active');
        const totalRent = propTenants.reduce((sum, t) => sum + (t.monthlyRent || 0), 0);
        const totalArrearsProp = propTenants.reduce((sum, t) => sum + ((t.balance || 0) > 0 ? (t.balance || 0) : 0), 0);
        return {
          property: prop.name,
          rent: totalRent,
          arrears: totalArrearsProp,
        };
      });

      // Top 5 defaulters
      const topDefaulters = tenants
        .filter(t => (t.balance || 0) > 0 && t.status === 'active')
        .sort((a, b) => (b.balance || 0) - (a.balance || 0))
        .slice(0, 5)
        .map(t => ({
          name: t.name,
          roomCode: t.roomCode,
          balance: t.balance || 0,
        }));

      setReport({
        totalTenants: tenants.length,
        totalProperties: properties.length,
        totalArrears,
        totalCollectedMonth,
        totalCollectedYear,
        rentBreakdown,
        topDefaulters,
      });
    } catch (error) {
      console.error('Error loading report:', error);
      Alert.alert('Error', 'Failed to load report data');
    } finally {
      setIsLoading(false);
    }
  };

  const exportCSV = async () => {
    if (!userId) return;
    setGenerating(true);
    try {
      // Get tenants for this landlord
      const tenantsQuery = query(tenantsCollection, where('userId', '==', userId));
      const tenantsSnapshot = await getDocs(tenantsQuery);
      
      // Get properties for this landlord
      const propertiesQuery = query(propertiesCollection, where('userId', '==', userId));
      const propertiesSnapshot = await getDocs(propertiesQuery);
      const properties = propertiesSnapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name }));

      // Build CSV data
      const headers = ['Name', 'Phone', 'Property', 'Room', 'Room Code', 'Monthly Rent', 'Balance', 'Status'];
      const rows = tenantsSnapshot.docs.map(doc => {
        const t = doc.data();
        const property = properties.find(p => p.id === t.propertyId);
        return [
          t.name,
          t.phone,
          property?.name || 'Unknown',
          t.room,
          t.roomCode,
          t.monthlyRent?.toString() || '0',
          t.balance?.toString() || '0',
          t.status || 'active',
        ];
      });

      const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
      
      // Share the CSV
      await Share.share({
        title: 'Tenants Report',
        message: csvContent,
      });
      
      Alert.alert('Success', 'Report generated and ready to share');
    } catch (error) {
      console.error('Error exporting:', error);
      Alert.alert('Error', 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return `KES ${(amount || 0).toLocaleString()}`;
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#27ae60" />
        <Text style={styles.loadingText}>Loading report...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Reports</Text>
        <TouchableOpacity onPress={exportCSV} style={styles.exportButton} disabled={generating}>
          <Text style={styles.exportButtonText}>{generating ? '...' : '📤 Export'}</Text>
        </TouchableOpacity>
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{report?.totalTenants}</Text>
          <Text style={styles.summaryLabel}>Total Tenants</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{report?.totalProperties}</Text>
          <Text style={styles.summaryLabel}>Properties</Text>
        </View>
        <View style={[styles.summaryCard, styles.arrearsCard]}>
          <Text style={[styles.summaryValue, styles.arrearsValue]}>{formatCurrency(report?.totalArrears || 0)}</Text>
          <Text style={styles.summaryLabel}>Total Arrears</Text>
        </View>
      </View>

      {/* Collection Stats */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>💰 Collection Stats</Text>
        <View style={styles.statsRow}>
          <Text style={styles.statsLabel}>This Month:</Text>
          <Text style={styles.statsValue}>{formatCurrency(report?.totalCollectedMonth || 0)}</Text>
        </View>
        <View style={styles.statsRow}>
          <Text style={styles.statsLabel}>This Year:</Text>
          <Text style={styles.statsValue}>{formatCurrency(report?.totalCollectedYear || 0)}</Text>
        </View>
      </View>

      {/* Rent Breakdown */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🏢 Rent Breakdown by Property</Text>
        {report?.rentBreakdown.length === 0 ? (
          <Text style={styles.emptyText}>No properties found</Text>
        ) : (
          report?.rentBreakdown.map((item, index) => (
            <View key={index} style={styles.breakdownRow}>
              <Text style={styles.propertyName}>{item.property}</Text>
              <View style={styles.breakdownNumbers}>
                <Text style={styles.rentAmount}>{formatCurrency(item.rent)}</Text>
                <Text style={styles.arrearsAmount}>Arrears: {formatCurrency(item.arrears)}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Top Defaulters */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>⚠️ Top 5 Defaulters</Text>
        {report?.topDefaulters.length === 0 ? (
          <Text style={styles.emptyText}>No defaulters! 🎉</Text>
        ) : (
          report?.topDefaulters.map((defaulter, index) => (
            <View key={index} style={styles.defaulterRow}>
              <View style={styles.defaulterLeft}>
                <Text style={styles.defaulterRank}>#{index + 1}</Text>
                <View>
                  <Text style={styles.defaulterName}>{defaulter.name}</Text>
                  <Text style={styles.defaulterRoom}>{defaulter.roomCode}</Text>
                </View>
              </View>
              <Text style={styles.defaulterBalance}>{formatCurrency(defaulter.balance)}</Text>
            </View>
          ))
        )}
      </View>

      {/* Quick Actions */}
      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.refreshButton} onPress={loadReport}>
          <Text style={styles.refreshButtonText}>🔄 Refresh Data</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#7f8c8d',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    padding: 5,
  },
  backText: {
    fontSize: 16,
    color: '#27ae60',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  exportButton: {
    padding: 8,
    backgroundColor: '#27ae60',
    borderRadius: 6,
  },
  exportButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  summaryGrid: {
    flexDirection: 'row',
    padding: 15,
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  arrearsCard: {
    backgroundColor: '#ffe5e5',
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  arrearsValue: {
    color: '#e74c3c',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#7f8c8d',
    marginTop: 5,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    margin: 15,
    marginTop: 0,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  statsLabel: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  statsValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#27ae60',
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  propertyName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2c3e50',
  },
  breakdownNumbers: {
    alignItems: 'flex-end',
  },
  rentAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#27ae60',
  },
  arrearsAmount: {
    fontSize: 11,
    color: '#e74c3c',
    marginTop: 2,
  },
  defaulterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  defaulterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  defaulterRank: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#95a5a6',
    width: 30,
  },
  defaulterName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2c3e50',
  },
  defaulterRoom: {
    fontSize: 11,
    color: '#7f8c8d',
    marginTop: 2,
  },
  defaulterBalance: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#e74c3c',
  },
  actionButtons: {
    padding: 15,
    marginBottom: 30,
  },
  refreshButton: {
    backgroundColor: '#3498db',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  refreshButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    color: '#27ae60',
    padding: 20,
    fontSize: 14,
  },
});