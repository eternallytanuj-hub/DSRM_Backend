// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SatelliteEscrow
 * @notice Production-grade escrow contract for the DSRM Orbital Access Exchange.
 *         Locks testnet ETH/USDC for satellite pass bookings and settles via signed
 *         telemetry oracle attestations or refunds upon breach/timeout.
 */
contract SatelliteEscrow {
    address public owner;
    address public oracleAddress;

    enum EscrowState {
        Inactive,
        Locked,
        Released,
        Refunded,
        PartiallySettled
    }

    struct EscrowRecord {
        bytes32 bookingId;
        address payable buyer;
        address payable operator;
        uint256 depositAmount;
        uint256 windowStart;
        uint256 windowEnd;
        EscrowState state;
        uint256 releaseAmount;
        uint256 refundAmount;
        bytes32 attestationHash;
        string satName;
    }

    // Top-level storage for single-escrow queries (as requested in spec)
    address public buyer;
    address payable public operator;
    uint256 public depositAmount;
    uint256 public windowStart;
    uint256 public windowEnd;
    EscrowState public state;
    bytes32 public latestAttestationHash;

    // Multi-booking registry
    mapping(bytes32 => EscrowRecord) public escrows;
    bytes32[] public bookingIds;
    bytes32 public latestBookingId;

    // Mutex
    bool private _reentrancyLocked;

    // Events
    event EscrowDeposited(
        bytes32 indexed bookingId,
        address indexed buyer,
        address indexed operator,
        uint256 amount,
        uint256 windowStart,
        uint256 windowEnd,
        string satName
    );

    event PaymentReleased(
        bytes32 indexed bookingId,
        address indexed operator,
        uint256 amount,
        bytes32 attestationHash
    );

    event BuyerRefunded(
        bytes32 indexed bookingId,
        address indexed buyer,
        uint256 amount,
        string reason
    );

    event PaymentSettled(
        bytes32 indexed bookingId,
        uint256 operatorAmount,
        uint256 refundAmount,
        bytes32 attestationHash
    );

    event OracleUpdated(address indexed oldOracle, address indexed newOracle);

    modifier onlyOracle() {
        require(msg.sender == oracleAddress, "SatelliteEscrow: caller is not the oracle");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "SatelliteEscrow: caller is not the owner");
        _;
    }

    modifier nonReentrant() {
        require(!_reentrancyLocked, "SatelliteEscrow: reentrant call");
        _reentrancyLocked = true;
        _;
        _reentrancyLocked = false;
    }

    constructor(address _oracleAddress) {
        require(_oracleAddress != address(0), "Invalid oracle address");
        owner = msg.sender;
        oracleAddress = _oracleAddress;
    }

    /**
     * @notice Deposit escrow with explicit booking parameters.
     */
    function depositEscrow(
        bytes32 _bookingId,
        address payable _operator,
        uint256 _windowStart,
        uint256 _windowEnd,
        string memory _satName
    ) public payable nonReentrant {
        require(msg.value > 0, "Deposit amount must be > 0");
        require(_operator != address(0), "Invalid operator address");
        require(_windowEnd > _windowStart, "Window end must be after window start");
        require(escrows[_bookingId].state == EscrowState.Inactive, "Booking ID already exists");

        EscrowRecord memory record = EscrowRecord({
            bookingId: _bookingId,
            buyer: payable(msg.sender),
            operator: _operator,
            depositAmount: msg.value,
            windowStart: _windowStart,
            windowEnd: _windowEnd,
            state: EscrowState.Locked,
            releaseAmount: 0,
            refundAmount: 0,
            attestationHash: bytes32(0),
            satName: _satName
        });

        escrows[_bookingId] = record;
        bookingIds.push(_bookingId);
        latestBookingId = _bookingId;

        // Synchronize top-level legacy fields
        buyer = msg.sender;
        operator = _operator;
        depositAmount = msg.value;
        windowStart = _windowStart;
        windowEnd = _windowEnd;
        state = EscrowState.Locked;

        emit EscrowDeposited(
            _bookingId,
            msg.sender,
            _operator,
            msg.value,
            _windowStart,
            _windowEnd,
            _satName
        );
    }

    /**
     * @notice Default deposit function without parameters (creates unique auto-id).
     */
    function depositEscrow() external payable {
        bytes32 autoBookingId = keccak256(
            abi.encodePacked(msg.sender, block.timestamp, bookingIds.length)
        );
        depositEscrow(
            autoBookingId,
            payable(owner),
            block.timestamp,
            block.timestamp + 1 hours,
            "GENERIC-ORBITAL-PASS"
        );
    }

    /**
     * @notice Release full payment to operator after oracle verifies delivery.
     */
    function releasePayment(bytes32 _bookingId, bytes32 _attestationHash) public onlyOracle nonReentrant {
        EscrowRecord storage record = escrows[_bookingId];
        require(record.state == EscrowState.Locked, "Escrow is not locked");

        uint256 amount = record.depositAmount;
        record.state = EscrowState.Released;
        record.releaseAmount = amount;
        record.attestationHash = _attestationHash;

        if (latestBookingId == _bookingId) {
            state = EscrowState.Released;
            latestAttestationHash = _attestationHash;
        }

        (bool sent, ) = record.operator.call{value: amount}("");
        require(sent, "Transfer to operator failed");

        emit PaymentReleased(_bookingId, record.operator, amount, _attestationHash);
    }

    /**
     * @notice Overload for releasing payment of the latest active booking.
     */
    function releasePayment() external onlyOracle {
        require(latestBookingId != bytes32(0), "No active booking");
        releasePayment(latestBookingId, bytes32(0));
    }

    /**
     * @notice Settle payment proportionally based on packet delivery basis points (0-10000).
     *         If packet delivery >= 9500 (95%), operator receives 100%.
     *         Otherwise, operator receives packetBps / 10000 and buyer is refunded remainder.
     */
    function settlePayment(
        bytes32 _bookingId,
        uint256 _packetBps,
        bytes32 _attestationHash
    ) external onlyOracle nonReentrant {
        EscrowRecord storage record = escrows[_bookingId];
        require(record.state == EscrowState.Locked, "Escrow is not locked");
        require(_packetBps <= 10000, "Invalid BPS");

        uint256 total = record.depositAmount;
        uint256 operatorShare;
        uint256 buyerShare;

        if (_packetBps >= 9500) {
            // >= 95% delivery: full payment
            operatorShare = total;
            buyerShare = 0;
            record.state = EscrowState.Released;
        } else if (_packetBps == 0) {
            // Complete packet failure: full refund
            operatorShare = 0;
            buyerShare = total;
            record.state = EscrowState.Refunded;
        } else {
            // Proportional settlement
            operatorShare = (total * _packetBps) / 10000;
            buyerShare = total - operatorShare;
            record.state = EscrowState.PartiallySettled;
        }

        record.releaseAmount = operatorShare;
        record.refundAmount = buyerShare;
        record.attestationHash = _attestationHash;

        if (latestBookingId == _bookingId) {
            state = record.state;
            latestAttestationHash = _attestationHash;
        }

        if (operatorShare > 0) {
            (bool opSent, ) = record.operator.call{value: operatorShare}("");
            require(opSent, "Operator transfer failed");
        }
        if (buyerShare > 0) {
            (bool buyerSent, ) = record.buyer.call{value: buyerShare}("");
            require(buyerSent, "Buyer refund failed");
        }

        emit PaymentSettled(_bookingId, operatorShare, buyerShare, _attestationHash);
    }

    /**
     * @notice Refund buyer in full. Callable by oracle at any time,
     *         or by the buyer themselves if window has closed and no release was triggered.
     */
    function refundBuyer(bytes32 _bookingId, string memory _reason) public nonReentrant {
        EscrowRecord storage record = escrows[_bookingId];
        require(record.state == EscrowState.Locked, "Escrow is not locked");

        bool isOracle = (msg.sender == oracleAddress);
        bool isBuyerExpired = (msg.sender == record.buyer && block.timestamp > record.windowEnd);
        bool isOwner = (msg.sender == owner);

        require(
            isOracle || isBuyerExpired || isOwner,
            "SatelliteEscrow: not authorized to trigger refund"
        );

        uint256 amount = record.depositAmount;
        record.state = EscrowState.Refunded;
        record.refundAmount = amount;

        if (latestBookingId == _bookingId) {
            state = EscrowState.Refunded;
        }

        (bool sent, ) = record.buyer.call{value: amount}("");
        require(sent, "Refund transfer to buyer failed");

        emit BuyerRefunded(_bookingId, record.buyer, amount, _reason);
    }

    /**
     * @notice Default refund function for latest booking.
     */
    function refundBuyer() external {
        require(latestBookingId != bytes32(0), "No active booking");
        refundBuyer(latestBookingId, "Default refund requested");
    }

    /**
     * @notice Update oracle address. Callable by owner.
     */
    function setOracleAddress(address _newOracle) external onlyOwner {
        require(_newOracle != address(0), "Invalid oracle address");
        emit OracleUpdated(oracleAddress, _newOracle);
        oracleAddress = _newOracle;
    }

    // View helpers
    function getEscrow(bytes32 _bookingId) external view returns (EscrowRecord memory) {
        return escrows[_bookingId];
    }

    function getAllBookingIds() external view returns (bytes32[] memory) {
        return bookingIds;
    }

    function getBookingCount() external view returns (uint256) {
        return bookingIds.length;
    }

    function getLatestBookingId() external view returns (bytes32) {
        return latestBookingId;
    }

    receive() external payable {
        // Fallback allows receiving direct funding
    }
}
