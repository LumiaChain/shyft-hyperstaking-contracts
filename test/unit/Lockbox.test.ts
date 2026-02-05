import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import fc from "fast-check";
import { expect } from "chai";
import { ethers } from "hardhat";
import { parseEther, parseUnits, ZeroAddress } from "ethers";

import * as shared from "../shared";

import { RouteRegistryDataStruct } from "../../typechain-types/contracts/hyperstaking/interfaces/IRouteRegistry";
import { StakeInfoDataStruct } from "../../typechain-types/contracts/hyperstaking/interfaces/IStakeInfoRoute";
import { StakeRewardDataStruct } from "../../typechain-types/contracts/hyperstaking/interfaces/IStakeRewardRoute";
import { StakeRedeemDataStruct } from "../../typechain-types/contracts/lumia-diamond/interfaces/IStakeRedeemRoute";
import { deployHyperStakingBase } from "../setup";

async function deployHyperStaking() {
  const {
    signers, testERC20, testWstETH, hyperStaking, lumiaDiamond, mailbox, invariantChecker,
  } = await loadFixture(deployHyperStakingBase);

  // -------------------- Apply Strategies --------------------

  // strategy asset price to eth 2:1
  const reserveAssetPrice = parseEther("2");

  const reserveStrategy = await shared.createReserveStrategy(
    hyperStaking.diamond, shared.nativeTokenAddress, await testERC20.getAddress(), reserveAssetPrice,
  );

  await hyperStaking.hyperFactory.connect(signers.vaultManager).addStrategy(
    reserveStrategy,
    "reserve eth vault 1",
    "rETH1",
  );

  // set dispatch fee after strategy is added
  const mailboxFee = parseEther("0.05");
  await mailbox.connect(signers.owner).setFee(mailboxFee);

  // set revenue fee recipient
  await hyperStaking.allocation.connect(signers.vaultManager).setFeeRecipient(reserveStrategy, signers.owner);

  // -------------------- Setup Checker --------------------

  await invariantChecker.addStrategy(await reserveStrategy.getAddress());
  setGlobalInvariantChecker(invariantChecker);

  // -------------------- Hyperlane Handler --------------------

  const { principalToken, vaultShares } = await shared.getDerivedTokens(
    lumiaDiamond.hyperlaneHandler,
    await reserveStrategy.getAddress(),
  );

  /* eslint-disable object-property-newline */
  return {
    hyperStaking, lumiaDiamond, // HyperStaking deployment
    testERC20, testWstETH, reserveStrategy, principalToken, vaultShares, // test contracts
    reserveAssetPrice, mailboxFee, // values
    mailbox, // modules
    signers, // signers
  };
  /* eslint-enable object-property-newline */
}

describe("Lockbox", function () {
  describe("Lockbox Facet", function () {
    afterEach(async () => {
      const c = globalThis.$invChecker;
      if (c) await c.check();
    });

    it("vault token properties should be correct", async function () {
      const { signers, hyperStaking, lumiaDiamond, testERC20, mailbox } = await loadFixture(deployHyperStaking);
      const { diamond, hyperFactory } = hyperStaking;
      const { hyperlaneHandler } = lumiaDiamond;
      const { owner, vaultManager } = signers;

      const strangeToken = await shared.deployTestERC20("Test 14 dec Coin", "t14c", 14);
      const reserveStrategy2 = await shared.createReserveStrategy(
        diamond, await strangeToken.getAddress(), await testERC20.getAddress(), parseEther("1"),
      );

      const vname = "strange vault";
      const vsymbol = "sv";

      await mailbox.connect(owner).setFee(0n);
      await hyperFactory.connect(vaultManager).addStrategy(
        reserveStrategy2,
        vname,
        vsymbol,
      );

      const vault2 = await shared.getDerivedTokens(
        hyperlaneHandler,
        await reserveStrategy2.getAddress(),
      );

      expect(await vault2.principalToken.name()).to.equal(`Principal ${vname}`);
      expect(await vault2.principalToken.symbol()).to.equal("p" + vsymbol);
      expect(await vault2.principalToken.decimals()).to.equal(14); // 14

      expect(await vault2.vaultShares.name()).to.equal(vname);
      expect(await vault2.vaultShares.symbol()).to.equal(vsymbol);
      expect(await vault2.vaultShares.decimals()).to.equal(14); // 14
    });

    it("test origin update and acl", async function () {
      const { signers, hyperStaking, lumiaDiamond } = await loadFixture(deployHyperStaking);
      const { lockbox } = hyperStaking;
      const { hyperlaneHandler } = lumiaDiamond;
      const { lumiaFactoryManager } = signers;

      await expect(hyperlaneHandler.setMailbox(lockbox)).to.be.reverted;

      // errors
      await expect(hyperlaneHandler.updateAuthorizedOrigin(
        ZeroAddress, true, 123,
      )).to.be.reverted;

      await expect(hyperlaneHandler.connect(lumiaFactoryManager).updateAuthorizedOrigin(
        ZeroAddress, true, 123,
      )).to.be.revertedWithCustomError(hyperlaneHandler, "OriginUpdateFailed");

      // events
      await expect(hyperlaneHandler.connect(lumiaFactoryManager).updateAuthorizedOrigin(
        lumiaFactoryManager, true, 123,
      ))
        .to.emit(hyperlaneHandler, "AuthorizedOriginUpdated")
        .withArgs(lumiaFactoryManager, true, 123);
    });

    it("proposes and applies mailbox and lumiaFactory updates after delay", async function () {
      const {
        signers, hyperStaking, lumiaDiamond, principalToken, vaultShares, mailbox,
      } = await loadFixture(deployHyperStaking);
      const { lockbox } = hyperStaking;
      const { hyperlaneHandler } = lumiaDiamond;
      const { vaultManager } = signers;

      const DELAY = 60 * 60 * 24; // 1 day

      const dummyMailbox = principalToken.target;
      const dummyFactory = vaultShares.target;

      // only vault manager can propose changes
      await expect(lockbox.proposeMailbox(dummyMailbox)).to.be.reverted;
      await expect(lockbox.proposeLumiaFactory(dummyFactory)).to.be.reverted;

      await expect(lockbox.connect(vaultManager).proposeMailbox(dummyMailbox))
        .to.emit(lockbox, "MailboxChangeProposed")
        .withArgs(dummyMailbox, await time.latest() + DELAY);

      await expect(lockbox.connect(vaultManager).proposeLumiaFactory(dummyFactory))
        .to.emit(lockbox, "LumiaFactoryChangeProposed")
        .withArgs(dummyFactory, await time.latest() + DELAY);

      // Too soon

      await expect(lockbox.connect(vaultManager).applyMailbox())
        .to.be.revertedWithCustomError(lockbox, "PendingChangeFailed");

      await expect(lockbox.connect(vaultManager).applyLumiaFactory())
        .to.be.revertedWithCustomError(lockbox, "PendingChangeFailed");

      // Fast forward time
      await time.increase(DELAY + 1);

      // OK

      await expect(lockbox.connect(vaultManager).applyMailbox())
        .to.emit(lockbox, "MailboxUpdated")
        .withArgs(mailbox, dummyMailbox);

      await expect(lockbox.connect(vaultManager).applyLumiaFactory())
        .to.emit(lockbox, "LumiaFactoryUpdated")
        .withArgs(hyperlaneHandler, dummyFactory);
    });

    it("stake deposit with non-zero mailbox fee", async function () {
      const { signers, hyperStaking, reserveStrategy, vaultShares, mailboxFee } = await loadFixture(deployHyperStaking);
      const { deposit } = hyperStaking;
      const { owner, alice } = signers;

      const sharesBefore = await vaultShares.balanceOf(alice);

      const stakeAmount = parseEther("2");

      await expect(deposit.deposit(
        reserveStrategy, alice, stakeAmount, { value: stakeAmount + mailboxFee },
      ))
        .to.emit(deposit, "Deposit")
        .withArgs(owner, alice, reserveStrategy, stakeAmount, /* reqId */ 1);

      const sharesAfter = await vaultShares.balanceOf(alice);
      expect(sharesAfter).to.be.gt(sharesBefore);
      expect(sharesAfter).to.be.eq(stakeAmount);

      expect(stakeAmount).to.be.eq(await vaultShares.totalSupply());
    });

    it("mailbox fee is needed when adding strategy too", async function () {
      const { signers, hyperStaking, reserveStrategy, mailboxFee } = await loadFixture(deployHyperStaking);
      const { diamond, hyperFactory, routeRegistry } = hyperStaking;
      const { vaultManager } = signers;

      // new pool and strategy
      const asset2 = await shared.deployTestERC20("Test Reserve Asset 2", "t2");

      const strategy2 = await shared.createReserveStrategy(
        diamond, shared.nativeTokenAddress, await asset2.getAddress(), parseEther("1"),
      );

      // revert if mailbox fee is not sent
      await expect(hyperFactory.connect(vaultManager).addStrategy(
        strategy2,
        "vault2",
        "v2",
      )).to.be.reverted;

      expect( // in a real scenario fee could depend on the token address, correct name and symbol
        await routeRegistry.quoteDispatchRouteRegistry({
          nonce: 1,
          strategy: reserveStrategy,
          name: "vault3",
          symbol: "v3",
          decimals: 18,
          metadata: "0x",
        } as RouteRegistryDataStruct),
      ).to.equal(mailboxFee);

      // quoteAddStrategy should return the same fee
      const quote = await hyperFactory.quoteAddStrategy(
        strategy2,
        "vault3",
        "v3",
      );
      expect(quote).to.equal(mailboxFee);

      await hyperFactory.connect(vaultManager).addStrategy(
        strategy2,
        "vault3",
        "v3",
        { value: mailboxFee },
      );
    });

    it("it should not be possible to frontrun redeem", async function () {
      const {
        signers, hyperStaking, lumiaDiamond, reserveStrategy, vaultShares, mailboxFee,
      } = await loadFixture(deployHyperStaking);
      const { deposit } = hyperStaking;
      const { stakeRedeemRoute, realAssets } = lumiaDiamond;
      const { alice, bob } = signers;

      const stakeAmount = parseEther("3");

      // quoteDeposit should return the same fee as mailboxFee
      const quote = await deposit.quoteDepositDispatch(
        reserveStrategy,
        alice,
        stakeAmount,
      );
      expect(quote).to.equal(mailboxFee);

      await deposit.deposit(reserveStrategy, alice, stakeAmount, { value: stakeAmount + mailboxFee });

      const sharesAfter = await vaultShares.balanceOf(alice);
      expect(sharesAfter).to.be.gt(0);

      const stakeRedeemData: StakeRedeemDataStruct = {
        nonce: 2,
        strategy: reserveStrategy,
        user: alice,
        redeemAmount: sharesAfter,
      };
      const dispatchFee = await stakeRedeemRoute.quoteDispatchStakeRedeem(stakeRedeemData);

      // quoteRedeem should return the same fee
      expect(await realAssets.quoteRedeem(
        reserveStrategy,
        bob,
        sharesAfter,
      )).to.equal(dispatchFee);

      await expect(realAssets.connect(bob).redeem(
        reserveStrategy, alice, bob, sharesAfter, { value: dispatchFee },
      ))
        .to.be.revertedWithCustomError(vaultShares, "ERC20InsufficientAllowance")
        .withArgs(bob, 0n, sharesAfter);

      // approve the shares to bob
      await vaultShares.connect(alice).approve(bob, sharesAfter);

      // now bob can redeem
      await expect(realAssets.connect(bob).redeem(
        reserveStrategy, alice, bob, sharesAfter, { value: dispatchFee },
      ))
        .to.emit(realAssets, "RwaRedeem")
        .withArgs(reserveStrategy, alice, bob, stakeAmount, sharesAfter);
    });

    it("redeem the should triger leave on the origin chain - non-zero mailbox fee", async function () {
      const {
        signers, hyperStaking, lumiaDiamond, reserveStrategy, principalToken, vaultShares, testERC20, reserveAssetPrice, mailboxFee,
      } = await loadFixture(deployHyperStaking);
      const { deposit, lockbox } = hyperStaking;
      const { realAssets, stakeRedeemRoute } = lumiaDiamond;
      const { alice } = signers;

      const stakeAmount = parseEther("3");
      const expectedAllocation = stakeAmount * parseEther("1") / reserveAssetPrice;

      await expect(deposit.deposit(
        reserveStrategy, alice, stakeAmount, { value: stakeAmount + mailboxFee },
      ))
        .to.emit(realAssets, "RwaMint")
        .withArgs(reserveStrategy, alice.address, stakeAmount, stakeAmount);

      const sharesAfter = await vaultShares.balanceOf(alice);
      expect(sharesAfter).to.eq(stakeAmount);

      await expect(realAssets.connect(alice).redeem(
        reserveStrategy, alice, alice, sharesAfter,
      ))
        .to.be.revertedWithCustomError(shared.errors, "DispatchUnderpaid");

      const stakeRedeemData: StakeRedeemDataStruct = {
        nonce: 3,
        strategy: reserveStrategy,
        user: alice,
        redeemAmount: sharesAfter,
      };
      const dispatchFee = await stakeRedeemRoute.quoteDispatchStakeRedeem(stakeRedeemData);

      await expect(realAssets.redeem(ZeroAddress, alice, alice, sharesAfter))
        // custom error from LibInterchainFactory (unfortunetaly hardhat doesn't support it)
        // .to.be.revertedWithCustomError(realAssets, "RouteDoesNotExist")
        .to.be.reverted;

      // redeem should return stakeAmount
      const redeemTx = realAssets.connect(alice).redeem(
        reserveStrategy, alice, alice, sharesAfter, { value: dispatchFee },
      );

      // lpToken -> vaultAsset -> strategy allocation -> stake withdraw
      await expect(redeemTx).to.changeTokenBalance(vaultShares, alice, -sharesAfter);
      await expect(redeemTx).to.changeTokenBalance(principalToken, vaultShares, -stakeAmount);

      await expect(redeemTx).to.changeTokenBalances(testERC20,
        [lockbox, reserveStrategy],
        [-expectedAllocation, expectedAllocation],
      );

      const lastClaimId = await shared.getLastClaimId(deposit, reserveStrategy, alice);
      const claimTx = shared.claimAtDeadline(deposit, lastClaimId, alice);
      await expect(claimTx)
        .to.changeEtherBalances(
          [alice, reserveStrategy],
          [stakeAmount, -stakeAmount],
        );

      expect(await vaultShares.balanceOf(alice)).to.eq(0);
    });

    it("should store failed redeem when strategy reverts", async function () {
      const {
        signers, hyperStaking, lumiaDiamond, reserveStrategy, vaultShares, mailboxFee,
      } = await loadFixture(deployHyperStaking);
      const { deposit, lockbox } = hyperStaking;
      const { realAssets, stakeRedeemRoute } = lumiaDiamond;
      const { alice, strategyManager } = signers;

      const stakeAmount = parseEther("2");

      await deposit.deposit(reserveStrategy, alice, stakeAmount, {
        value: stakeAmount + mailboxFee,
      });

      // make strategy revert, by withdrawing all stake
      const reserveStrategySupply = parseEther("50") + stakeAmount;
      await reserveStrategy.connect(strategyManager).withdrawStakeAsset(reserveStrategySupply);

      const shares = await vaultShares.balanceOf(alice);

      const stakeRedeemData: StakeRedeemDataStruct = {
        nonce: 4,
        strategy: reserveStrategy,
        user: alice,
        redeemAmount: shares,
      };
      const dispatchFee = await stakeRedeemRoute.quoteDispatchStakeRedeem(stakeRedeemData);

      // triggers the message that will eventually cause revert on the origin chain strategy
      await expect(realAssets.connect(alice).redeem(reserveStrategy, alice, alice, shares - 10n, { value: dispatchFee }))
        .to.emit(lockbox, "StakeRedeemFailed")
        .withArgs(reserveStrategy, alice, shares - 10n, 0n);

      // second faliled redeem
      await expect(realAssets.connect(alice).redeem(reserveStrategy, alice, alice, 10n, { value: dispatchFee }))
        .to.emit(lockbox, "StakeRedeemFailed")
        .withArgs(reserveStrategy, alice, 10n, 1n);

      // check it was recorded
      const count = await lockbox.getFailedRedeemCount();
      expect(count).to.eq(2);

      const ids = await lockbox.getUserFailedRedeemIds(alice);
      expect(ids.length).to.eq(2);

      const failed = await lockbox.getFailedRedeems([...ids]);
      expect(failed[0].strategy).to.eq(reserveStrategy);
      expect(failed[0].user).to.eq(alice);
      expect(failed[0].amount).to.eq(shares - 10n);

      expect(failed[1].strategy).to.eq(reserveStrategy);
      expect(failed[1].user).to.eq(alice);
      expect(failed[1].amount).to.eq(10n);
    });

    it("should allow re-executing a previously failed redeem", async function () {
      const {
        signers, hyperStaking, lumiaDiamond, reserveStrategy, principalToken, vaultShares, mailboxFee, testERC20, reserveAssetPrice,
      } = await loadFixture(deployHyperStaking);
      const { deposit, lockbox } = hyperStaking;
      const { realAssets, stakeRedeemRoute } = lumiaDiamond;
      const { owner, alice, strategyManager } = signers;

      const stakeAmount = parseEther("2");
      const expectedAllocation = stakeAmount * parseEther("1") / reserveAssetPrice;

      await deposit.deposit(reserveStrategy, alice, stakeAmount, {
        value: stakeAmount + mailboxFee,
      });

      const shares = await vaultShares.balanceOf(alice);

      const stakeRedeemData: StakeRedeemDataStruct = {
        nonce: 1,
        strategy: reserveStrategy,
        user: alice,
        redeemAmount: shares,
      };
      const dispatchFee = await stakeRedeemRoute.quoteDispatchStakeRedeem(stakeRedeemData);

      // make strategy revert, by withdrawing all stake
      const reserveStrategySupply = parseEther("50") + stakeAmount;
      await reserveStrategy.connect(strategyManager).withdrawStakeAsset(reserveStrategySupply);

      const redeemTx = realAssets.connect(alice).redeem(
        reserveStrategy, alice, alice, shares, { value: dispatchFee },
      );

      await expect(redeemTx).to.emit(lockbox, "StakeRedeemFailed");

      // failed redeem still moves the funds on the lumia side
      await expect(redeemTx).to.changeTokenBalance(principalToken, vaultShares, -stakeAmount);

      const id = (await lockbox.getUserFailedRedeemIds(alice.address))[0];

      // now let the strategy succeed
      await owner.sendTransaction({
        to: reserveStrategy,
        value: reserveStrategySupply,
      });

      const reexecuteTx = lockbox.connect(alice).reexecuteFailedRedeem(id);

      await expect(reexecuteTx)
        .to.emit(lockbox, "StakeRedeemReexecuted")
        .withArgs(reserveStrategy, alice, shares, id);

      // should move the funds
      await expect(reexecuteTx).to.changeTokenBalance(testERC20, lockbox, -expectedAllocation);
      await expect(reexecuteTx).to.changeTokenBalances(testERC20,
        [lockbox, reserveStrategy],
        [-expectedAllocation, expectedAllocation],
      );

      // should no longer be retrievable
      const failed = await lockbox.getFailedRedeems([id]);
      expect(failed[0].user).to.eq(ZeroAddress);
    });

    it("edge-case: redeem 1 wei after 10x gain: allocation rounds to 0", async function () {
      const {
        signers,
        hyperStaking,
        lumiaDiamond,
        reserveStrategy,
        vaultShares,
        mailbox,
        reserveAssetPrice,
      } = await loadFixture(deployHyperStaking);

      const { deposit, lockbox } = hyperStaking;
      const { realAssets } = lumiaDiamond;
      const { alice, owner, strategyManager } = signers;

      await mailbox.connect(owner).setFee(0n);

      // --- stake so Alice has shares ---
      const stakeAmount = parseEther("10");
      await deposit.connect(alice).deposit(
        reserveStrategy, alice, stakeAmount, { value: stakeAmount },
      );

      const userShares = await vaultShares.balanceOf(alice);
      expect(userShares).to.eq(stakeAmount);

      // --- pump price on the strategy ---
      await reserveStrategy.connect(strategyManager).setAssetPrice(reserveAssetPrice * 10n); // 10x gain

      // for a 1-wei share, capUnits should floor to 0
      const tinyShares = 1n;

      // redeeming this tiny amount should revert because allocation exit is zero
      await realAssets.connect(alice).redeem(reserveStrategy, alice, alice, tinyShares);

      const failedRedeem = await lockbox.getUserFailedRedeemIds(alice);
      expect(failedRedeem.length).to.eq(1);

      // re-execute should revert (cannot fulfill zero-amount exit)
      await expect(
        lockbox.connect(alice).reexecuteFailedRedeem(failedRedeem[0]),
      ).to.be.revertedWithCustomError(shared.errors, "ZeroAllocationExit");
    });
  });

  describe("Lockbox: mailbox fee + quote", function () {
    afterEach(async () => {
      const c = globalThis.$invChecker;
      if (c) await c.check();
    });

    it("mailbox fee + quote for an ERC20 strategy", async function () {
      const {
        signers, hyperStaking, lumiaDiamond, mailbox, testERC20, testWstETH,
      } = await loadFixture(deployHyperStaking);

      const { owner, alice, strategyManager, vaultManager } = signers;
      const { deposit, allocation, hyperFactory } = hyperStaking;
      const { realAssets } = lumiaDiamond;

      // Configure mailbox fee (>0)

      const mailboxFee = parseEther("0.01"); // 0.01 ETH
      await mailbox.connect(owner).setFee(mailboxFee);

      // Deploy + setup new ERC20 strategy

      const erc20Strategy = await shared.createReserveStrategy(
        hyperStaking.diamond, await testERC20.getAddress(), await testWstETH.getAddress(), parseEther("1"),
      );

      // give strategy some supply so allocation works
      await testWstETH.connect(owner).transfer(erc20Strategy, parseEther("100"));

      const qAddStrategy = await hyperFactory.quoteAddStrategy(
        erc20Strategy,
        "reserve erc20 vault",
        "rERC",
      );
      expect(qAddStrategy).to.equal(mailboxFee);
      await hyperFactory.connect(signers.vaultManager).addStrategy(
        erc20Strategy,
        "reserve erc20 vault",
        "rERC",
        { value: mailboxFee },
      );

      // --- stake deposit

      const stakeAmount = parseEther("5");

      const qStake = await deposit.quoteDepositDispatch(
        erc20Strategy,
        alice,
        stakeAmount,
      );
      expect(qStake).to.equal(mailboxFee);

      // approve stake token
      await testERC20.connect(alice).approve(deposit, stakeAmount);

      // underpay -> revert
      await expect(
        deposit.connect(alice).deposit(
          erc20Strategy,
          alice,
          stakeAmount,
          { value: mailboxFee - 1n },
        ),
      ).to.be.revertedWithCustomError(shared.errors, "DispatchUnderpaid");

      // correct pay
      await deposit.connect(alice).deposit(
        erc20Strategy,
        alice,
        stakeAmount,
        { value: mailboxFee },
      );

      const { vaultShares } = await shared.getDerivedTokens(
        lumiaDiamond.hyperlaneHandler,
        await erc20Strategy.getAddress(),
      );

      const sharesAfter = await vaultShares.balanceOf(alice);
      expect(sharesAfter).to.equal(stakeAmount);

      // --- report

      // give strategy some gain to trigger report revenue
      await erc20Strategy
        .connect(strategyManager)
        .setAssetPrice(parseEther("1.2")); // arbitrary pump

      const qReport = await allocation.quoteReport(erc20Strategy);
      expect(qReport).to.equal(mailboxFee);

      // need feeRecipient for report
      await allocation
        .connect(vaultManager)
        .setFeeRecipient(erc20Strategy, owner);

      // underpay
      await expect(
        allocation.connect(vaultManager).report(
          erc20Strategy,
          { value: mailboxFee - 1n },
        ),
      ).to.be.revertedWithCustomError(shared.errors, "DispatchUnderpaid");

      // correct pay -> success
      await allocation.connect(vaultManager).report(erc20Strategy, { value: mailboxFee });

      // --- redeem

      const userShares = await vaultShares.balanceOf(alice);

      const qRedeem = await realAssets.quoteRedeem(
        erc20Strategy,
        alice,
        userShares,
      );
      expect(qRedeem).to.equal(mailboxFee);

      // underpay -> revert
      await expect(
        realAssets.connect(alice).redeem(
          erc20Strategy,
          alice,
          alice,
          userShares,
          { value: qRedeem - 1n },
        ),
      ).to.be.revertedWithCustomError(shared.errors, "DispatchUnderpaid");

      // correct pay -> success
      const redeemTx = await realAssets.connect(alice).redeem(
        erc20Strategy,
        alice,
        alice,
        userShares,
        { value: qRedeem },
      );

      await expect(redeemTx).to.changeTokenBalance(
        vaultShares,
        alice,
        -userShares,
      );
    });

    it("fuzzes stake, report and redeem fees for native reserve strategy", async function () {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            // 0.1 .. 10 ETH
            stakeEth: fc.integer({ min: 1, max: 100 }),
            // mailbox fee between 1 wei and 0.5 ETH
            mailboxFeeWei: fc.bigInt({
              min: 1n,
              max: parseEther("0.5") as bigint,
            }),
          }),
          async ({ stakeEth, mailboxFeeWei }) => {
            const {
              signers, hyperStaking, lumiaDiamond, reserveStrategy, vaultShares, mailbox, reserveAssetPrice,
            } = await loadFixture(deployHyperStaking);

            const { deposit, allocation } = hyperStaking;
            const { realAssets } = lumiaDiamond;
            const { owner, alice, strategyManager, vaultManager } = signers;

            // ----- configure mailbox fee (always > 0) -----

            await mailbox.connect(owner).setFee(mailboxFeeWei);

            const stakeAmount = parseUnits(stakeEth.toString(), 17);

            // ================= STAKE =================

            const quotedStakeFee = await deposit.quoteDepositDispatch(
              reserveStrategy,
              alice,
              stakeAmount,
            );

            // quote* should match mailbox fee
            expect(quotedStakeFee).to.equal(mailboxFeeWei);

            // underpaying value must revert
            await expect(
              deposit.connect(alice).deposit(
                reserveStrategy,
                alice,
                stakeAmount,
                { value: stakeAmount + mailboxFeeWei - 1n },
              ),
            ).to.be.revertedWithCustomError(
              shared.errors,
              "InsufficientValue",
            );

            // correct value should pass
            const stakeTx1 = await deposit.connect(alice).deposit(
              reserveStrategy,
              alice,
              stakeAmount,
              { value: stakeAmount + mailboxFeeWei },
            );

            await expect(stakeTx1)
              .to.emit(deposit, "Deposit")
              .withArgs(alice, alice, reserveStrategy, stakeAmount, /* reqId */ 1);

            const sharesAfterFirst = await vaultShares.balanceOf(alice);
            expect(sharesAfterFirst).to.equal(stakeAmount);

            // second stake: cannot reuse ETH already held on diamond
            await expect(
              deposit.connect(alice).deposit(
                reserveStrategy,
                alice,
                stakeAmount,
                { value: stakeAmount + mailboxFeeWei - 1n },
              ),
            ).to.be.revertedWithCustomError(
              shared.errors,
              "InsufficientValue",
            );

            const stakeTx2 = await deposit.connect(alice).deposit(
              reserveStrategy,
              alice,
              stakeAmount,
              { value: stakeAmount + mailboxFeeWei },
            );
            await expect(stakeTx2)
              .to.emit(deposit, "Deposit")
              .withArgs(alice, alice, reserveStrategy, stakeAmount, /* reqId */ 2);

            const totalShares = await vaultShares.balanceOf(alice);
            expect(totalShares).to.equal(stakeAmount * 2n);

            // ================= REPORT =================

            // make some gains: bump price (2x) and pretend reserve grew
            await reserveStrategy.connect(strategyManager).setAssetPrice(reserveAssetPrice * 2n);

            // ensure there is some revenue; if not, skip this run
            const expectedRevenue = await allocation.checkRevenue(reserveStrategy);
            if (expectedRevenue === 0n) {
              return;
            }

            const quotedReportFee = await allocation.quoteReport(
              reserveStrategy,
            );
            expect(quotedReportFee).to.equal(mailboxFeeWei);

            // report without enough value should revert
            await expect(
              allocation.connect(vaultManager).report(
                reserveStrategy,
                { value: mailboxFeeWei - 1n },
              ),
            ).to.be.revertedWithCustomError(
              shared.errors,
              "DispatchUnderpaid",
            );

            const reportTx = await allocation
              .connect(vaultManager)
              .report(reserveStrategy, { value: mailboxFeeWei });

            await expect(reportTx).to.emit(allocation, "StakeCompounded");

            // ================= REDEEM =================

            const userShares = await vaultShares.balanceOf(alice);
            expect(userShares).to.be.gt(0n);

            // split into two redeems to ensure fee is required each time
            const halfShares = userShares / 2n || 1n;
            const restShares = userShares - halfShares;

            const quotedRedeemFee1 = await realAssets.quoteRedeem(
              reserveStrategy,
              alice,
              halfShares,
            );

            // quote must match mailbox fee
            expect(quotedRedeemFee1).to.equal(mailboxFeeWei);

            // underpay must revert
            await expect(
              realAssets.connect(alice).redeem(
                reserveStrategy,
                alice,
                alice,
                halfShares,
                { value: quotedRedeemFee1 - 1n },
              ),
            ).to.be.revertedWithCustomError(
              shared.errors,
              "DispatchUnderpaid",
            );

            const redeemTx1 = await realAssets.connect(alice).redeem(
              reserveStrategy,
              alice,
              alice,
              halfShares,
              { value: quotedRedeemFee1 },
            );

            await expect(redeemTx1)
              .to.changeTokenBalance(vaultShares, alice, -halfShares);

            // second redeem for the rest
            const quotedRedeemFee2 = await realAssets.quoteRedeem(
              reserveStrategy,
              alice,
              restShares,
            );
            expect(quotedRedeemFee2).to.equal(mailboxFeeWei);

            await expect(
              realAssets.connect(alice).redeem(
                reserveStrategy,
                alice,
                alice,
                restShares,
                { value: quotedRedeemFee2 - 1n },
              ),
            ).to.be.revertedWithCustomError(
              shared.errors,
              "DispatchUnderpaid",
            );

            const redeemTx2 = await realAssets.connect(alice).redeem(
              reserveStrategy,
              alice,
              alice,
              restShares,
              { value: quotedRedeemFee2 },
            );

            await expect(redeemTx2).to.changeTokenBalance(vaultShares, alice, -restShares);

            // user fully out of shares at the end
            expect(await vaultShares.balanceOf(alice)).to.equal(0n);
          },
        ),
        { numRuns: 40 },
      );
    });
  });

  describe("Hyperlane Mailbox Messages", function () {
    // remove null bytes from (solidity bytes32) the end of a string (right padding)
    const decodeString = (s: string) => {
      return s.replace(/\0+$/, "");
    };

    async function deployTestWrapper() {
      return await ethers.deployContract("TestHyperlaneMessages", []);
    }

    it("serialization and deserialization", async function () {
      const testWrapper = await loadFixture(deployTestWrapper);

      // RouteRegister

      const messageRR: RouteRegistryDataStruct = {
        nonce: 1,
        strategy: ZeroAddress,
        name: "Test Token",
        symbol: "TT",
        decimals: 2,
        metadata: "0x1234",
      };

      const bytesRR = await testWrapper.serializeRouteRegistry(messageRR);

      expect(await testWrapper.messageType(bytesRR)).to.equal(0);
      expect(await testWrapper.nonce(bytesRR)).to.equal(1);
      expect(await testWrapper.strategy(bytesRR)).to.equal(messageRR.strategy);
      expect(decodeString(await testWrapper.name(bytesRR))).to.equal(messageRR.name);
      expect(decodeString(await testWrapper.symbol(bytesRR))).to.equal(messageRR.symbol);
      expect(await testWrapper.routeRegistryMetadata(bytesRR)).to.equal(messageRR.metadata);

      // StakeInfo

      const messageSI: StakeInfoDataStruct = {
        nonce: 2,
        strategy: "0x7846C5d815300D27c4975C93Fdbe19b9D352F0d3",
        user: "0xE5326B17594A697B27F9807832A0CF7CB025B4bb",
        stake: parseEther("4.04"),
      };

      const bytesSI = await testWrapper.serializeStakeInfo(messageSI);

      expect(await testWrapper.messageType(bytesSI)).to.equal(1);
      expect(await testWrapper.nonce(bytesSI)).to.equal(2);
      expect(await testWrapper.strategy(bytesSI)).to.equal(messageSI.strategy);
      expect(await testWrapper.user(bytesSI)).to.equal(messageSI.user);
      expect(await testWrapper.stake(bytesSI)).to.equal(messageSI.stake);

      // StakeReward

      const messageRI: StakeRewardDataStruct = {
        nonce: 3,
        strategy: "0x7846C5d815300D27c4975C93Fdbe19b9D352F0d3",
        stakeAdded: parseEther("1.11"),
      };

      const bytesRI = await testWrapper.serializeStakeReward(messageRI);

      expect(await testWrapper.messageType(bytesRI)).to.equal(2);
      expect(await testWrapper.nonce(bytesRI)).to.equal(3);
      expect(await testWrapper.strategy(bytesRI)).to.equal(messageRI.strategy);
      expect(await testWrapper.stakeAdded(bytesRI)).to.equal(messageRI.stakeAdded);

      // StakeRedeem

      const messageSR: StakeRedeemDataStruct = {
        nonce: 1,
        strategy: "0x337baDc64C441e6956B87D248E5Bc284828cfa84",
        user: "0xcb37D723BE930Fca39F46F019d84E1B359d2170C",
        redeemAmount: parseEther("2"),
      };

      const bytesSR = await testWrapper.serializeStakeRedeem(messageSR);

      expect(await testWrapper.messageType(bytesSR)).to.equal(3);
      expect(await testWrapper.nonce(bytesSR)).to.equal(1);
      expect(await testWrapper.strategy(bytesSR)).to.equal(messageSR.strategy);
      expect(await testWrapper.user(bytesSR)).to.equal(messageSR.user);
      expect(await testWrapper.redeemAmount(bytesSR)).to.equal(messageSR.redeemAmount);
    });

    it("should revert on forged messages from an invalid origin domain", async function () {
      const { signers, hyperStaking, reserveStrategy, mailbox, mailboxFee } = await loadFixture(deployHyperStaking);
      const { allocation, deposit, lockbox } = hyperStaking;
      const { alice, bob } = signers;

      const stakeAmount = parseEther("1");
      await deposit.connect(alice).deposit(
        reserveStrategy,
        alice.address,
        stakeAmount,
        { value: stakeAmount + mailboxFee },
      );

      const reserveStrategyAddress = await reserveStrategy.getAddress();
      const beforeStakeInfo = await allocation.stakeInfo(reserveStrategyAddress);
      expect(beforeStakeInfo.pendingExitStake).to.equal(0n);

      const lockboxState = await lockbox.lockboxData();
      const destinationDomain = Number(lockboxState.destination);
      const lumiaFactory = lockboxState.lumiaFactory;
      const lockboxAddress = await lockbox.getAddress();

      const attackerDomain = destinationDomain + 1;
      const messageBody = ethers.solidityPacked(
        ["uint64", "bytes32", "bytes32", "uint256"],
        [
          3n, // MessageType.StakeRedeem
          ethers.zeroPadValue(reserveStrategyAddress, 32),
          ethers.zeroPadValue(alice.address, 32),
          stakeAmount,
        ],
      );

      const forgedMessage = ethers.solidityPacked(
        ["uint8", "uint32", "uint32", "bytes32", "uint32", "bytes32", "bytes"],
        [
          33,
          42,
          attackerDomain,
          ethers.zeroPadValue(lumiaFactory, 32),
          destinationDomain,
          ethers.zeroPadValue(lockboxAddress, 32),
          messageBody,
        ],
      );

      await expect(
        mailbox.connect(bob).process("0x", forgedMessage),
      ).to.be.revertedWithCustomError(shared.errors, "BadOriginDestination")
        .withArgs(attackerDomain);
    });

    it("stake / redeem and check hyperlane messages", async function () {
      const {
        signers, hyperStaking, lumiaDiamond, reserveStrategy, vaultShares, mailboxFee,
      } = await loadFixture(deployHyperStaking);
      const { deposit, lockbox } = hyperStaking;
      const { hyperlaneHandler, realAssets, stakeRedeemRoute } = lumiaDiamond;
      const { alice } = signers;

      const testWrapper = await loadFixture(deployTestWrapper);

      const stakeAmount = parseEther("1.2");
      await deposit.deposit(
        reserveStrategy, alice, stakeAmount, { value: stakeAmount + mailboxFee },
      );

      const lastMessage = await hyperlaneHandler.lastMessage();
      expect(lastMessage.sender).to.eq(await lockbox.getAddress());

      // check StakeInfo message data
      expect(await testWrapper.messageType(lastMessage.data)).to.eq(1);
      expect(await testWrapper.strategy(lastMessage.data)).to.eq(reserveStrategy);
      expect(await testWrapper.user(lastMessage.data)).to.eq(alice);
      expect(await testWrapper.stake(lastMessage.data)).to.eq(stakeAmount);

      const sharesAfter = await vaultShares.balanceOf(alice);
      expect(sharesAfter).to.eq(stakeAmount);

      const stakeRedeemData: StakeRedeemDataStruct = {
        nonce: 1,
        strategy: reserveStrategy,
        user: alice,
        redeemAmount: sharesAfter,
      };
      const dispatchFee = await stakeRedeemRoute.quoteDispatchStakeRedeem(stakeRedeemData);

      await realAssets.connect(alice).redeem(
        reserveStrategy, alice, alice, sharesAfter, { value: dispatchFee },
      );

      const lockboxData = await lockbox.lockboxData();
      expect(lockboxData.lastMessage.sender).to.eq(hyperlaneHandler.target);

      // check StakeRedeem message data
      expect(await testWrapper.messageType(lockboxData.lastMessage.data)).to.eq(3);
      expect(await testWrapper.strategy(lockboxData.lastMessage.data)).to.eq(reserveStrategy);
      expect(await testWrapper.user(lockboxData.lastMessage.data)).to.eq(alice);
      expect(await testWrapper.redeemAmount(lockboxData.lastMessage.data)).to.eq(sharesAfter);
    });
  });
});
