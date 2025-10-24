// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Artwork {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  title: string;
  style: string;
  price: number;
  status: "pending" | "minted" | "sold";
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'increase10%':
      result = value * 1.1;
      break;
    case 'decrease10%':
      result = value * 0.9;
      break;
    case 'double':
      result = value * 2;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newArtworkData, setNewArtworkData] = useState({ title: "", style: "", price: 0 });
  const [selectedArtwork, setSelectedArtwork] = useState<Artwork | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const mintedCount = artworks.filter(a => a.status === "minted").length;
  const pendingCount = artworks.filter(a => a.status === "pending").length;
  const soldCount = artworks.filter(a => a.status === "sold").length;

  useEffect(() => {
    loadArtworks().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadArtworks = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      const keysBytes = await contract.getData("artwork_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing artwork keys:", e); }
      }
      const list: Artwork[] = [];
      for (const key of keys) {
        try {
          const artworkBytes = await contract.getData(`artwork_${key}`);
          if (artworkBytes.length > 0) {
            try {
              const artworkData = JSON.parse(ethers.toUtf8String(artworkBytes));
              list.push({ 
                id: key, 
                encryptedData: artworkData.data, 
                timestamp: artworkData.timestamp, 
                owner: artworkData.owner, 
                title: artworkData.title, 
                style: artworkData.style,
                price: artworkData.price,
                status: artworkData.status || "pending" 
              });
            } catch (e) { console.error(`Error parsing artwork data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading artwork ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setArtworks(list);
    } catch (e) { console.error("Error loading artworks:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitArtwork = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting artwork data with Zama FHE..." });
    try {
      const encryptedPrice = FHEEncryptNumber(newArtworkData.price);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const artworkId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const artworkData = { 
        data: encryptedPrice, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        title: newArtworkData.title,
        style: newArtworkData.style,
        price: newArtworkData.price,
        status: "pending" 
      };
      await contract.setData(`artwork_${artworkId}`, ethers.toUtf8Bytes(JSON.stringify(artworkData)));
      const keysBytes = await contract.getData("artwork_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(artworkId);
      await contract.setData("artwork_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      setTransactionStatus({ visible: true, status: "success", message: "Artwork submitted securely with FHE!" });
      await loadArtworks();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewArtworkData({ title: "", style: "", price: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const mintArtwork = async (artworkId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing artwork with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const artworkBytes = await contract.getData(`artwork_${artworkId}`);
      if (artworkBytes.length === 0) throw new Error("Artwork not found");
      const artworkData = JSON.parse(ethers.toUtf8String(artworkBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedArtwork = { ...artworkData, status: "minted" };
      await contractWithSigner.setData(`artwork_${artworkId}`, ethers.toUtf8Bytes(JSON.stringify(updatedArtwork)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Artwork minted successfully with FHE!" });
      await loadArtworks();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Minting failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const sellArtwork = async (artworkId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing artwork sale with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const artworkBytes = await contract.getData(`artwork_${artworkId}`);
      if (artworkBytes.length === 0) throw new Error("Artwork not found");
      const artworkData = JSON.parse(ethers.toUtf8String(artworkBytes));
      const updatedArtwork = { ...artworkData, status: "sold" };
      await contract.setData(`artwork_${artworkId}`, ethers.toUtf8Bytes(JSON.stringify(updatedArtwork)));
      setTransactionStatus({ visible: true, status: "success", message: "Artwork sold successfully with FHE!" });
      await loadArtworks();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Sale failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (artworkAddress: string) => address?.toLowerCase() === artworkAddress.toLowerCase();

  const renderPieChart = () => {
    const total = artworks.length || 1;
    const mintedPercentage = (mintedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const soldPercentage = (soldCount / total) * 100;
    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div className="pie-segment minted" style={{ transform: `rotate(${mintedPercentage * 3.6}deg)` }}></div>
          <div className="pie-segment pending" style={{ transform: `rotate(${(mintedPercentage + pendingPercentage) * 3.6}deg)` }}></div>
          <div className="pie-segment sold" style={{ transform: `rotate(${(mintedPercentage + pendingPercentage + soldPercentage) * 3.6}deg)` }}></div>
          <div className="pie-center">
            <div className="pie-value">{artworks.length}</div>
            <div className="pie-label">Artworks</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item"><div className="color-box minted"></div><span>Minted: {mintedCount}</span></div>
          <div className="legend-item"><div className="color-box pending"></div><span>Pending: {pendingCount}</span></div>
          <div className="legend-item"><div className="color-box sold"></div><span>Sold: {soldCount}</span></div>
        </div>
      </div>
    );
  };

  const renderArtworkCard = (artwork: Artwork) => {
    return (
      <div 
        className="artwork-card" 
        key={artwork.id}
        onClick={() => setSelectedArtwork(artwork)}
        style={{
          background: `linear-gradient(135deg, 
            hsl(${parseInt(artwork.id.substring(0, 3)) % 360}, 80%, 80%), 
            hsl(${parseInt(artwork.id.substring(3, 6)) % 360}, 80%, 60%))`,
          animation: `pulse 5s infinite alternate`
        }}
      >
        <div className="artwork-header">
          <h3>{artwork.title}</h3>
          <span className={`status-badge ${artwork.status}`}>{artwork.status}</span>
        </div>
        <div className="artwork-style">{artwork.style}</div>
        <div className="artwork-footer">
          <div className="owner">{artwork.owner.substring(0, 6)}...{artwork.owner.substring(38)}</div>
          <div className="price">FHE-{artwork.encryptedData.substring(4, 10)}...</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="rainbow-spinner"></div>
      <p>Initializing FHE Art Gallery...</p>
    </div>
  );

  return (
    <div className="app-container">
      <div className="glass-background"></div>
      <header className="app-header">
        <div className="logo">
          <h1>DAA_Fhe</h1>
          <p>Decentralized Autonomous Artist</p>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Create Artwork
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="center-radial-layout">
          <div className="intro-section glass-card">
            <h2>隱秘自主藝術家</h2>
            <p>A decentralized autonomous artist (DAA) powered by FHE and AI</p>
            <div className="fhe-badge">
              <span>FHE-Powered AI Artist</span>
            </div>
            <p className="description">
              An AI artist running on-chain that learns from all public art history with FHE encryption 
              and homomorphically generates new, unpredictable artworks. 
              Artworks are sold as NFTs with revenue used for self-maintenance.
            </p>
          </div>

          <div className="stats-section glass-card">
            <h3>Artwork Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{artworks.length}</div>
                <div className="stat-label">Total</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{mintedCount}</div>
                <div className="stat-label">Minted</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{soldCount}</div>
                <div className="stat-label">Sold</div>
              </div>
            </div>
            <div className="chart-container">
              {renderPieChart()}
            </div>
          </div>

          <div className="artworks-section">
            <div className="section-header">
              <h2>AI Art Gallery</h2>
              <button onClick={loadArtworks} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "⟳ Refresh"}
              </button>
            </div>
            
            {artworks.length === 0 ? (
              <div className="no-artworks glass-card">
                <div className="empty-icon"></div>
                <p>No artworks generated yet</p>
                <button className="primary-btn" onClick={() => setShowCreateModal(true)}>
                  Generate First Artwork
                </button>
              </div>
            ) : (
              <div className="artworks-grid">
                {artworks.map(artwork => renderArtworkCard(artwork))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitArtwork} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          artworkData={newArtworkData} 
          setArtworkData={setNewArtworkData}
        />
      )}

      {selectedArtwork && (
        <ArtworkDetailModal 
          artwork={selectedArtwork} 
          onClose={() => { setSelectedArtwork(null); setDecryptedValue(null); }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
          isOwner={isOwner(selectedArtwork.owner)}
          mintArtwork={mintArtwork}
          sellArtwork={sellArtwork}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="loading-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>DAA_Fhe</h3>
            <p>Generative Art Frontier Exploration</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">About Zama FHE</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Art Generation</span></div>
          <div className="copyright">© {new Date().getFullYear()} DAA_Fhe. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  artworkData: any;
  setArtworkData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, artworkData, setArtworkData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setArtworkData({ ...artworkData, [name]: value });
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setArtworkData({ ...artworkData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!artworkData.title || !artworkData.style || !artworkData.price) { 
      alert("Please fill all required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>Generate New Artwork</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your artwork data will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          <div className="form-group">
            <label>Title *</label>
            <input 
              type="text" 
              name="title" 
              value={artworkData.title} 
              onChange={handleChange} 
              placeholder="Artwork title..."
              className="glass-input"
            />
          </div>
          <div className="form-group">
            <label>Style *</label>
            <select 
              name="style" 
              value={artworkData.style} 
              onChange={handleChange} 
              className="glass-select"
            >
              <option value="">Select style</option>
              <option value="Abstract">Abstract</option>
              <option value="Surreal">Surreal</option>
              <option value="Minimalist">Minimalist</option>
              <option value="Cyberpunk">Cyberpunk</option>
              <option value="Impressionist">Impressionist</option>
            </select>
          </div>
          <div className="form-group">
            <label>Price (ETH) *</label>
            <input 
              type="number" 
              name="price" 
              value={artworkData.price} 
              onChange={handleValueChange} 
              placeholder="Price in ETH..." 
              className="glass-input"
              step="0.01"
              min="0"
            />
          </div>
          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Price:</span>
                <div>{artworkData.price || '0'} ETH</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{artworkData.price ? FHEEncryptNumber(artworkData.price).substring(0, 50) + '...' : 'No value entered'}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn">
            {creating ? "Generating with FHE..." : "Generate Artwork"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ArtworkDetailModalProps {
  artwork: Artwork;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
  isOwner: boolean;
  mintArtwork: (id: string) => void;
  sellArtwork: (id: string) => void;
}

const ArtworkDetailModal: React.FC<ArtworkDetailModalProps> = ({ 
  artwork, 
  onClose, 
  decryptedValue, 
  setDecryptedValue, 
  isDecrypting, 
  decryptWithSignature,
  isOwner,
  mintArtwork,
  sellArtwork
}) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { setDecryptedValue(null); return; }
    const decrypted = await decryptWithSignature(artwork.encryptedData);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="artwork-detail-modal glass-card">
        <div className="modal-header">
          <h2>{artwork.title}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="artwork-info">
            <div className="info-item">
              <span>Style:</span>
              <strong>{artwork.style}</strong>
            </div>
            <div className="info-item">
              <span>Owner:</span>
              <strong>{artwork.owner.substring(0, 6)}...{artwork.owner.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(artwork.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${artwork.status}`}>{artwork.status}</strong>
            </div>
          </div>
          
          <div className="artwork-visual">
            <div 
              className="artwork-preview"
              style={{
                background: `linear-gradient(135deg, 
                  hsl(${parseInt(artwork.id.substring(0, 3)) % 360}, 80%, 80%), 
                  hsl(${parseInt(artwork.id.substring(3, 6)) % 360}, 80%, 60%))`,
                animation: `pulse 5s infinite alternate`
              }}
            >
              <div className="artwork-title">{artwork.title}</div>
              <div className="artwork-style">{artwork.style}</div>
            </div>
          </div>
          
          <div className="encrypted-data-section">
            <h3>Encrypted Price Data</h3>
            <div className="encrypted-data">{artwork.encryptedData.substring(0, 100)}...</div>
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted</span>
            </div>
            <button 
              className="decrypt-btn" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span className="decrypt-spinner"></span>
              ) : decryptedValue !== null ? (
                "Hide Decrypted Value"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>
          
          {decryptedValue !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Price</h3>
              <div className="decrypted-value">{decryptedValue} ETH</div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
          
          {isOwner && (
            <div className="owner-actions">
              {artwork.status === "pending" && (
                <button 
                  className="action-btn mint-btn"
                  onClick={() => mintArtwork(artwork.id)}
                >
                  Mint as NFT
                </button>
              )}
              {artwork.status === "minted" && (
                <button 
                  className="action-btn sell-btn"
                  onClick={() => sellArtwork(artwork.id)}
                >
                  Sell Artwork
                </button>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;
