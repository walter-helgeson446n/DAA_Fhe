pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DAA_Fhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    bool public batchOpen;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    euint32 internal encryptedArtworkCount;
    euint32 internal encryptedTotalLearningDataPoints;
    euint32 internal encryptedRandomSeed;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event PauseToggled(bool indexed paused);
    event CooldownSecondsSet(uint256 indexed oldCooldownSeconds, uint256 indexed newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event ArtworkGenerated(uint256 indexed batchId, address indexed provider);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 artworkCount, uint256 totalLearningDataPoints, uint256 randomSeed);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error ReplayDetected();
    error StateMismatch();
    error InvalidProof();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[msg.sender] = true;
        emit ProviderAdded(msg.sender);
        cooldownSeconds = 60; // Default cooldown
        currentBatchId = 0;
        batchOpen = false;
        encryptedArtworkCount = FHE.asEuint32(0);
        encryptedTotalLearningDataPoints = FHE.asEuint32(0);
        encryptedRandomSeed = FHE.asEuint32(block.timestamp); // Initial seed
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PauseToggled(_paused);
    }

    function setCooldownSeconds(uint256 _cooldownSeconds) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = _cooldownSeconds;
        emit CooldownSecondsSet(oldCooldown, _cooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) {
            currentBatchId++;
        }
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (batchOpen) {
            batchOpen = false;
            emit BatchClosed(currentBatchId);
        }
    }

    function submitLearningData(uint256 dataPoints) external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (!batchOpen) revert BatchNotOpen();
        lastSubmissionTime[msg.sender] = block.timestamp;

        euint32 eDataPoints = FHE.asEuint32(dataPoints);
        encryptedTotalLearningDataPoints = encryptedTotalLearningDataPoints.add(eDataPoints);

        // Update random seed with new data influence
        encryptedRandomSeed = encryptedRandomSeed.mul(eDataPoints).add(FHE.asEuint32(block.timestamp));
    }

    function generateArtwork() external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (!batchOpen) revert BatchNotOpen();
        lastSubmissionTime[msg.sender] = block.timestamp;

        // AI "learns" and generates new artwork
        // This is a simplified representation of the FHE computation
        // encryptedArtworkCount = (encryptedTotalLearningDataPoints * encryptedRandomSeed) % some_modulus
        // For this example, we'll just increment the count and use the random seed
        encryptedArtworkCount = encryptedArtworkCount.add(FHE.asEuint32(1));
        encryptedRandomSeed = encryptedRandomSeed.mul(FHE.asEuint32(2)).add(FHE.asEuint32(block.timestamp));

        emit ArtworkGenerated(currentBatchId, msg.sender);
    }

    function requestArtworkStatsDecryption() external onlyProvider whenNotPaused checkDecryptionCooldown {
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        euint32[] memory cts = new euint32[](3);
        cts[0] = encryptedArtworkCount;
        cts[1] = encryptedTotalLearningDataPoints;
        cts[2] = encryptedRandomSeed;

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatchId,
            stateHash: stateHash,
            processed: false
        });

        emit DecryptionRequested(requestId, currentBatchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayDetected();
        // Security: Replay protection prevents processing the same decryption result multiple times.

        euint32[] memory currentCts = new euint32[](3);
        currentCts[0] = encryptedArtworkCount;
        currentCts[1] = encryptedTotalLearningDataPoints;
        currentCts[2] = encryptedRandomSeed;

        bytes32 currentHash = _hashCiphertexts(currentCts);
        if (currentHash != decryptionContexts[requestId].stateHash) revert StateMismatch();
        // Security: State hash verification ensures that the contract's state (specifically, the ciphertexts
        // that were meant to be decrypted) has not changed between the decryption request and the callback.
        // This prevents scenarios where an attacker might try to get a decryption for stale or manipulated data.

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert InvalidProof();

        uint256 artworkCount = abi.decode(cleartexts[0:32], (uint256));
        uint256 totalLearningDataPoints = abi.decode(cleartexts[32:64], (uint256));
        uint256 randomSeed = abi.decode(cleartexts[64:96], (uint256));

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, artworkCount, totalLearningDataPoints, randomSeed);
    }

    function _hashCiphertexts(euint32[] memory cts) internal pure returns (bytes32) {
        bytes32[3] memory b32Cts;
        for (uint i = 0; i < cts.length; i++) {
            b32Cts[i] = FHE.toBytes32(cts[i]);
        }
        return keccak256(abi.encode(b32Cts, address(this)));
    }

    function _initIfNeeded(euint32 storage self, uint256 value) internal {
        if (!FHE.isInitialized(self)) {
            self = FHE.asEuint32(value);
        }
    }

    function _requireInitialized(euint32 storage self) internal view {
        if (!FHE.isInitialized(self)) revert("NotInitialized");
    }
}