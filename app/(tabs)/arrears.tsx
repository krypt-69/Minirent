import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, RefreshControl, ScrollView } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { db, tenantsCollection, propertiesCollection } from '../../lib/firebase';
import { collection, getDocs, query, where, doc, updateDoc } from 'firebase/firestore';

type Property = {
  id: string;
  name: string;
  code: string;
  userId?: string;
};

type Tenant = {
  id: string;
  name: string;
  phone: string;
  room: string;
  roomCode: string;
  propertyId: string;
  propertyName?: string;
  monthlyRent: number;
  balance: number;
  status: string;
  userId?: string;
};

type FilterType = 'all' | 'unpaid' | 'partial' | 'paid';

export default function ArrearsScreen() {
  const router = useRouter();
  const { userId } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [filteredTenants, setFilteredTenants] = useState<Tenant[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<string>('all');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (userId) {
      loadData();
    }
  }, [userId]);

  useEffect(() => {
    applyFilters();
  }, [selectedProperty, filterType, searchQuery, tenants]);

  const loadData = async () => {
    if (!userId) return;
    try {
      // Load properties for this user
      const propertiesQuery = query(propertiesCollection, where('userId', '==', userId));
      const propertiesSnapshot = await getDocs(propertiesQuery);
      const propertiesList: Property[] = [];
      propertiesSnapshot.forEach((doc) => {
        propertiesList.push({ id: doc.id, ...doc.data() } as Property);
      });
      setProperties(propertiesList);

      // Load tenants for this user
      const tenantsQuery = query(tenantsCollection, where('userId', '==', userId));
      const tenantsSnapshot = await getDocs(tenantsQuery);
      const tenantsList: Tenant[] = [];
      tenantsSnapshot.forEach((doc) => {
        const data = doc.data();
        const property = propertiesList.find(p => p.id === data.propertyId);
        tenantsList.push({
          id: doc.id,
          name: data.name,
          phone: data.phone,
          room: data.room,
          roomCode: data.roomCode,
          propertyId: data.propertyId,
          propertyName: property?.name,
          monthlyRent: data.monthlyRent,
          balance: data.balance || 0,
          status: data.status || 'active',
        });
      });
      setTenants(tenantsList);
    } catch (error) {
      console.error('Error loading data:', error);
      Alert.alert('Error', 'Failed to load data');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...tenants];

    // Filter by property
    if (selectedProperty !== 'all') {
      filtered = filtered.filter(t => t.propertyId === selectedProperty);
    }

    // Filter by balance status
    if (filterType === 'unpaid') {
      filtered = filtered.filter(t => t.balance > 0 && t.balance >= t.monthlyRent);
    } else if (filterType === 'partial') {
      filtered = filtered.filter(t => t.balance > 0 && t.balance < t.monthlyRent);
    } else if (filterType === 'paid') {
      filtered = filtered.filter(t => t.balance <= 0);
    }

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(t => 
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.roomCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.phone.includes(searchQuery)
      );
    }

    // Sort by balance (highest first)
    filtered.sort((a, b) => b.balance - a.balance);

    setFilteredTenants(filtered);
  };

  const onRefresh = useCallback(() => {
    if (!userId) return;
    setRefreshing(true);
    loadData();
  }, [userId]);

  const getBalanceStatus = (balance: number, monthlyRent: number) => {
    if (balance <= 0) return 'paid';
    if (balance >= monthlyRent) return 'unpaid';
    return 'partial';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return '#27ae60';
      case 'partial': return '#f39c12';
      case 'unpaid': return '#e74c3c';
      default: return '#95a5a6';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'paid': return '✅ Paid';
      case 'partial': return '⚠️ Partial';
      case 'unpaid': return '❌ Unpaid';
      default: return 'Unknown';
    }
  };

  const formatCurrency = (amount: number) => {
    return `KES ${amount.toLocaleString()}`;
  };

  const handleRecordPayment = (tenant: Tenant) => {
    router.push({
      pathname: '/(tabs)/payments',
      params: { tenantId: tenant.id }
    });
  };

  const renderTenantItem = ({ item }: { item: Tenant }) => {
    const status = getBalanceStatus(item.balance, item.monthlyRent);
    const statusColor = getStatusColor(status);
    
    return (
      <TouchableOpacity 
        style={styles.tenantCard}
        onPress={() => router.push(`/tenant-details?id=${item.id}`)}
      >
        <View style={styles.tenantHeader}>
          <Text style={styles.tenantName}>{item.name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>{getStatusText(status)}</Text>
          </View>
        </View>
        
        <Text style={styles.tenantDetails}>
          {item.propertyName} • Room {item.room} ({item.roomCode})
        </Text>
        
        <View style={styles.balanceContainer}>
          <View>
            <Text style={styles.rentLabel}>Monthly Rent</Text>
            <Text style={styles.rentAmount}>{formatCurrency(item.monthlyRent)}</Text>
          </View>
          <View style={styles.balanceRight}>
            <Text style={styles.balanceLabel}>Balance</Text>
            <Text style={[styles.balanceAmount, { color: statusColor }]}>
              {formatCurrency(Math.abs(item.balance))}
            </Text>
          </View>
        </View>
        
        <TouchableOpacity 
          style={styles.payButton}
          onPress={() => handleRecordPayment(item)}
        >
          <Text style={styles.payButtonText}>Record Payment</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const getTotalArrears = () => {
    return filteredTenants.reduce((sum, t) => sum + (t.balance > 0 ? t.balance : 0), 0);
  };

  const getUnpaidCount = () => {
    return filteredTenants.filter(t => t.balance > 0).length;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Arrears Dashboard</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Stats Summary */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{filteredTenants.length}</Text>
          <Text style={styles.statLabel}>Total Tenants</Text>
        </View>
        <View style={[styles.statCard, styles.statWarning]}>
          <Text style={styles.statNumber}>{getUnpaidCount()}</Text>
          <Text style={styles.statLabel}>In Arrears</Text>
        </View>
        <View style={[styles.statCard, styles.statDanger]}>
          <Text style={styles.statNumber}>{formatCurrency(getTotalArrears())}</Text>
          <Text style={styles.statLabel}>Total Arrears</Text>
        </View>
      </View>

      {/* Filters */}
      <View style={styles.filtersContainer}>
        {/* Property Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          <TouchableOpacity 
            style={[styles.filterChip, selectedProperty === 'all' && styles.activeFilter]}
            onPress={() => setSelectedProperty('all')}
          >
            <Text style={[styles.filterText, selectedProperty === 'all' && styles.activeFilterText]}>All Properties</Text>
          </TouchableOpacity>
          {properties.map(prop => (
            <TouchableOpacity 
              key={prop.id}
              style={[styles.filterChip, selectedProperty === prop.id && styles.activeFilter]}
              onPress={() => setSelectedProperty(prop.id)}
            >
              <Text style={[styles.filterText, selectedProperty === prop.id && styles.activeFilterText]}>{prop.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Status Filter */}
        <View style={styles.statusFilter}>
          <TouchableOpacity 
            style={[styles.statusChip, filterType === 'all' && styles.activeStatusChip]}
            onPress={() => setFilterType('all')}
          >
            <Text style={[styles.statusChipText, filterType === 'all' && styles.activeStatusText]}>All</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.statusChip, filterType === 'unpaid' && styles.activeStatusChip]}
            onPress={() => setFilterType('unpaid')}
          >
            <Text style={[styles.statusChipText, filterType === 'unpaid' && styles.activeStatusText]}>Unpaid</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.statusChip, filterType === 'partial' && styles.activeStatusChip]}
            onPress={() => setFilterType('partial')}
          >
            <Text style={[styles.statusChipText, filterType === 'partial' && styles.activeStatusText]}>Partial</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.statusChip, filterType === 'paid' && styles.activeStatusChip]}
            onPress={() => setFilterType('paid')}
          >
            <Text style={[styles.statusChipText, filterType === 'paid' && styles.activeStatusText]}>Paid</Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, room code, or phone..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Tenants List */}
      <FlatList
        data={filteredTenants}
        renderItem={renderTenantItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No tenants found</Text>
            <Text style={styles.emptySubtext}>
              {searchQuery ? 'Try a different search' : 'Add tenants to see them here'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  statsContainer: {
    flexDirection: 'row',
    padding: 15,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  statWarning: {
    backgroundColor: '#fff3e0',
  },
  statDanger: {
    backgroundColor: '#ffe5e5',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
  },
  statLabel: {
    fontSize: 11,
    color: '#7f8c8d',
    marginTop: 4,
  },
  filtersContainer: {
    backgroundColor: 'white',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  filterScroll: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    marginRight: 10,
  },
  activeFilter: {
    backgroundColor: '#27ae60',
  },
  filterText: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  activeFilterText: {
    color: 'white',
    fontWeight: '600',
  },
  statusFilter: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  statusChip: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    marginHorizontal: 4,
  },
  activeStatusChip: {
    backgroundColor: '#27ae60',
  },
  statusChipText: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  activeStatusText: {
    color: 'white',
    fontWeight: '600',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
  },
  list: {
    padding: 15,
  },
  tenantCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 15,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  tenantHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tenantName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    color: 'white',
    fontWeight: '600',
  },
  tenantDetails: {
    fontSize: 13,
    color: '#7f8c8d',
    marginBottom: 12,
  },
  balanceContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  rentLabel: {
    fontSize: 11,
    color: '#95a5a6',
  },
  rentAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
  },
  balanceRight: {
    alignItems: 'flex-end',
  },
  balanceLabel: {
    fontSize: 11,
    color: '#95a5a6',
  },
  balanceAmount: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  payButton: {
    backgroundColor: '#27ae60',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  payButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 50,
  },
  emptyText: {
    fontSize: 16,
    color: '#95a5a6',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#bdc3c7',
    textAlign: 'center',
  },
});