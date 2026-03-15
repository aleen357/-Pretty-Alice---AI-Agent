import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { Camera, Plus, Trash2, X, Loader2, Package, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { compressImage } from '../utils/image';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Product {
  id: string;
  name: string;
  brand: string;
  category: string;
  shade?: string;
  imageUrl: string;
  addedAt: any;
}

interface VanityManagerProps {
  userId: string;
  onClose: () => void;
}

export default function VanityManager({ userId, onClose }: VanityManagerProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [wishlist, setWishlist] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'kit' | 'wishlist'>('kit');
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', brand: '', category: '', shade: '' });
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    const path = `users/${userId}/vanity`;
    const q = query(
      collection(db, path),
      orderBy('addedAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      setProducts(items);
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, path));
    return unsubscribe;
  }, [userId]);

  useEffect(() => {
    const path = `users/${userId}/wishlist`;
    const q = query(
      collection(db, path),
      orderBy('addedAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setWishlist(items);
    }, (error) => handleFirestoreError(error, OperationType.LIST, path));
    return unsubscribe;
  }, [userId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      try {
        const compressed = await compressImage(url);
        setSelectedImage(compressed);
        
        // Trigger Vanity Vision AI
        setIsAnalyzing(true);
        const { analyzeProductImage } = await import('../services/gemini');
        const analysis = await analyzeProductImage(compressed.split(',')[1]);
        if (analysis) {
          setNewProduct(prev => ({
            ...prev,
            name: analysis.name || prev.name,
            brand: analysis.brand || prev.brand,
            category: analysis.category || prev.category,
            shade: analysis.shade || prev.shade
          }));
        }
      } catch (error) {
        console.error("File processing failed:", error);
      } finally {
        URL.revokeObjectURL(url);
        setIsAnalyzing(false);
      }
    }
  };

  const addProduct = async () => {
    if (!newProduct.name || !selectedImage) return;
    setIsUploading(true);
    try {
      const path = `users/${userId}/vanity`;
      await addDoc(collection(db, path), {
        ...newProduct,
        imageUrl: selectedImage,
        addedAt: serverTimestamp()
      });
      setNewProduct({ name: '', brand: '', category: '', shade: '' });
      setSelectedImage(null);
      setIsAdding(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${userId}/vanity`);
    } finally {
      setIsUploading(false);
    }
  };

  const deleteProduct = async (id: string) => {
    const path = `users/${userId}/vanity/${id}`;
    try {
      await deleteDoc(doc(db, 'users', userId, 'vanity', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="p-6 border-b border-white/5 flex flex-col gap-6 bg-black/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 rounded-xl">
                <Package className="w-6 h-6 text-emerald-500" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Pretty Alice Vanity</h2>
                <p className="text-xs text-zinc-500">Manage your kit and beauty essentials</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <X className="w-6 h-6 text-zinc-400" />
            </button>
          </div>

          <div className="flex gap-2 p-1 bg-black/40 rounded-xl w-fit">
            <button 
              onClick={() => setActiveTab('kit')}
              className={cn(
                "px-6 py-2 rounded-lg text-sm font-bold transition-all",
                activeTab === 'kit' ? "bg-emerald-600 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              My Kit
            </button>
            <button 
              onClick={() => setActiveTab('wishlist')}
              className={cn(
                "px-6 py-2 rounded-lg text-sm font-bold transition-all",
                activeTab === 'wishlist' ? "bg-emerald-600 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              Beauty Essentials
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {activeTab === 'kit' ? (
            <>
              <AnimatePresence>
                {isAdding && (
                  <motion.div 
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-4">
                          <div className="relative">
                            <input 
                              type="text" 
                              placeholder="Product Name"
                              value={newProduct.name}
                              onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50"
                            />
                            {isAnalyzing && (
                              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 text-[10px] text-emerald-500 font-bold uppercase tracking-tighter">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Vanity Vision AI
                              </div>
                            )}
                          </div>
                          <input 
                            type="text" 
                            placeholder="Brand"
                            value={newProduct.brand}
                            onChange={(e) => setNewProduct({ ...newProduct, brand: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50"
                          />
                          <div className="grid grid-cols-2 gap-4">
                            <select 
                              value={newProduct.category}
                              onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50"
                            >
                              <option value="">Category</option>
                              <option value="Foundation">Foundation</option>
                              <option value="Concealer">Concealer</option>
                              <option value="Blush">Blush</option>
                              <option value="Bronzer">Bronzer</option>
                              <option value="Eyeshadow">Eyeshadow</option>
                              <option value="Lipstick">Lipstick</option>
                              <option value="Other">Other</option>
                            </select>
                            <input 
                              type="text" 
                              placeholder="Shade"
                              value={newProduct.shade}
                              onChange={(e) => setNewProduct({ ...newProduct, shade: e.target.value })}
                              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50"
                            />
                          </div>
                        </div>
                      <div className="flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-xl p-4 hover:border-emerald-500/30 transition-colors relative group">
                        {selectedImage ? (
                          <div className="relative w-full h-full">
                            <img src={selectedImage} className="w-full h-32 object-cover rounded-lg" />
                            <button 
                              onClick={() => setSelectedImage(null)}
                              className="absolute -top-2 -right-2 p-1 bg-red-500 rounded-full"
                            >
                              <X className="w-3 h-3 text-white" />
                            </button>
                          </div>
                        ) : (
                          <label className="cursor-pointer flex flex-col items-center gap-2">
                            <Camera className="w-8 h-8 text-zinc-500 group-hover:text-emerald-500 transition-colors" />
                            <span className="text-xs text-zinc-500">Upload Product Photo</span>
                            <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                          </label>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-end gap-3">
                      <button 
                        onClick={() => setIsAdding(false)}
                        className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={addProduct}
                        disabled={isUploading || !newProduct.name || !selectedImage}
                        className="px-6 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Add to Kit
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {!isAdding && (
                <button 
                  onClick={() => setIsAdding(true)}
                  className="w-full py-4 border-2 border-dashed border-white/10 rounded-2xl flex items-center justify-center gap-2 text-zinc-400 hover:border-emerald-500/30 hover:text-emerald-500 transition-all group"
                >
                  <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
                  <span className="font-medium">Add New Product</span>
                </button>
              )}

              {loading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                </div>
              ) : products.length === 0 ? (
                <div className="text-center py-12 space-y-4">
                  <div className="inline-block p-4 bg-white/5 rounded-full">
                    <Package className="w-12 h-12 text-zinc-600" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-white font-medium">Your kit is empty</p>
                    <p className="text-sm text-zinc-500">Add your makeup products so Alice can give better advice!</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {products.map((product) => (
                    <motion.div 
                      key={product.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="group relative bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-emerald-500/30 transition-all"
                    >
                      <img src={product.imageUrl} className="w-full h-32 object-cover" />
                      <div className="p-3">
                        <h4 className="text-sm font-bold text-white truncate">{product.name}</h4>
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-zinc-500 uppercase tracking-widest">{product.brand || 'Unknown Brand'}</p>
                          {product.shade && (
                            <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded text-zinc-400 border border-white/5">{product.shade}</span>
                          )}
                        </div>
                      </div>
                      <button 
                        onClick={() => deleteProduct(product.id)}
                        className="absolute top-2 right-2 p-2 bg-black/60 backdrop-blur-md rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:bg-red-500 hover:text-white"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              {wishlist.length === 0 ? (
                <div className="text-center py-12 space-y-4">
                  <div className="inline-block p-4 bg-white/5 rounded-full">
                    <Sparkles className="w-12 h-12 text-zinc-600" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-white font-medium">No recommendations yet</p>
                    <p className="text-sm text-zinc-500">Chat with Alice to get personalized product suggestions!</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {wishlist.map((item) => (
                    <div key={item.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center justify-between group hover:border-emerald-500/30 transition-all">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-emerald-500/10 rounded-xl">
                          <Sparkles className="w-5 h-5 text-emerald-500" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-white">{item.name}</h4>
                          <p className="text-xs text-zinc-500">{item.reason}</p>
                        </div>
                      </div>
                      <button 
                        onClick={async () => {
                          try {
                            await deleteDoc(doc(db, 'users', userId, 'wishlist', item.id));
                          } catch (e) { console.error(e); }
                        }}
                        className="p-2 text-zinc-500 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/5 bg-black/20 flex justify-between items-center">
          <div className="flex items-center gap-2 text-emerald-500">
            <Sparkles className="w-4 h-4" />
            <span className="text-xs font-medium">Alice will use these to guide you!</span>
          </div>
          <button 
            onClick={onClose}
            className="px-8 py-3 bg-white text-black font-bold rounded-xl hover:bg-zinc-200 transition-all"
          >
            Done
          </button>
        </div>
      </motion.div>
    </div>
  );
}
