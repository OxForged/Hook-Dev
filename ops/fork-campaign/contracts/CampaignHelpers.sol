// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// Test doubles for the fork campaign. Deployed ONLY on a local anvil fork.
/// Written from scratch: nothing here imports GPL or unlicensed code.

/// @notice Throwaway ERC-20. Anyone can mint. Worthless by construction.
contract CampaignToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

interface IVaultLock {
    function lock(bytes calldata data) external returns (bytes memory);
}

interface IVaultDelta {
    function currencyDelta(address settler, address currency) external view returns (int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

/// @notice Generic lock-holder. `run` takes the Vault lock and, inside `lockAcquired`, executes an
/// arbitrary call list with this contract as msg.sender. Lets the campaign drive Vault
/// `take/settle/sync/mint/burn/clear` and pool-manager `swap/modifyLiquidity/mint/burn/donate`
/// directly, without a periphery contract in between.
contract VaultActor {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    error CallFailed(uint256 index, bytes revertData);
    error NotVault();

    address public immutable vault;
    bool private _armed;

    constructor(address vault_) {
        vault = vault_;
    }

    receive() external payable {}

    function run(Call[] calldata calls) external payable returns (bytes[] memory results) {
        _armed = true;
        bytes memory out = IVaultLock(vault).lock(abi.encode(calls));
        _armed = false;
        results = abi.decode(out, (bytes[]));
    }

    /// Same call list, NOT inside a lock. For proving lock gating.
    function exec(Call[] calldata calls) external payable returns (bytes[] memory results) {
        results = _execute(calls);
    }

    function lockAcquired(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != vault || !_armed) revert NotVault();
        Call[] memory calls = abi.decode(data, (Call[]));
        return abi.encode(_executeMem(calls));
    }

    function _execute(Call[] calldata calls) private returns (bytes[] memory results) {
        results = new bytes[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory ret) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!ok) revert CallFailed(i, ret);
            results[i] = ret;
        }
    }

    function _executeMem(Call[] memory calls) private returns (bytes[] memory results) {
        results = new bytes[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory ret) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!ok) revert CallFailed(i, ret);
            results[i] = ret;
        }
    }

    /// Self-call only (as an entry in the call list): zero this actor's open delta in each currency -
    /// pay a debt (sync, transfer, settle; native via settle{value}) or take a credit to itself.
    function settleAll(address[] calldata currencies) external {
        if (msg.sender != address(this)) revert NotVault();
        for (uint256 i; i < currencies.length; ++i) {
            address cur = currencies[i];
            int256 d = IVaultDelta(vault).currencyDelta(address(this), cur);
            if (d < 0) {
                uint256 owed = uint256(-d);
                if (cur == address(0)) {
                    IVaultDelta(vault).settle{value: owed}();
                } else {
                    IVaultDelta(vault).sync(cur);
                    CampaignToken(cur).transfer(vault, owed);
                    IVaultDelta(vault).settle();
                }
            } else if (d > 0) {
                IVaultDelta(vault).take(cur, address(this), uint256(d));
            }
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

/// @notice Answers `launchOriginOf(poolId)` so LatchLaunchRegistry's vouch path can be exercised.
contract MockLaunchpad {
    mapping(bytes32 => address) public creatorOf;

    function setCreator(bytes32 poolId, address creator) external {
        creatorOf[poolId] = creator;
    }

    function launchOriginOf(bytes32 poolId) external view returns (address) {
        return creatorOf[poolId];
    }
}

/// @notice A contract whose code can be swapped for a different one by anvil_setCode, used to
/// exercise `refreshLaunchpadCode` / `refreshPermissions`. Exposes a configurable bitmap.
contract BitmapHook {
    uint16 public bitmap;

    constructor(uint16 bitmap_) {
        bitmap = bitmap_;
    }

    function setBitmap(uint16 b) external {
        bitmap = b;
    }

    function getHooksRegistrationBitmap() external view returns (uint16) {
        return bitmap;
    }
}

/// @notice Minimal CLPositionManager subscriber: records notifications, never reverts.
contract CampaignSubscriber {
    uint256 public subscribes;
    uint256 public unsubscribes;
    uint256 public modifies;
    uint256 public burns;

    function notifySubscribe(uint256, bytes memory) external {
        ++subscribes;
    }

    function notifyUnsubscribe(uint256) external {
        ++unsubscribes;
    }

    function notifyModifyLiquidity(uint256, int256, int256) external {
        ++modifies;
    }

    fallback() external {
        ++burns; // notifyBurn has a struct argument; a fallback keeps this stub free of core types
    }
}
