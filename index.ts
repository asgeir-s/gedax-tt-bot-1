/**
 * Should start with a ether balance of what you want to trade with.
 */
import { config } from "./config"
import * as GTT from "gdax-trading-toolkit"
import { Big } from "gdax-trading-toolkit/build/src/lib/types"
import {
  GDAX_WS_FEED,
  GDAXFeed,
  GDAXFeedConfig,
  GDAXExchangeAPI,
} from "gdax-trading-toolkit/build/src/exchanges"
import { GDAX_API_URL } from "gdax-trading-toolkit/build/src/exchanges/gdax/GDAXExchangeAPI"
import {
  PlaceOrderMessage,
  TickerMessage,
  LiveBookConfig,
  Action,
  Trigger,
  createTickerTrigger,
  createPriceTrigger,
} from "gdax-trading-toolkit/build/src/core"
import { LiveOrder } from "gdax-trading-toolkit/build/src/lib"
import {
  LiveOrderbook,
  SkippedMessageEvent,
  TradeMessage,
} from "gdax-trading-toolkit/build/src/core"
import { Ticker } from "gdax-trading-toolkit/build/src/exchanges/PublicExchangeAPI"
import { CumulativePriceLevel } from "gdax-trading-toolkit/build/src/lib"
import { GDAXConfig } from "gdax-trading-toolkit/build/src/exchanges/gdax/GDAXInterfaces"

const product = "ETH-EUR"
const logger = GTT.utils.ConsoleLoggerFactory()

const gdaxConfig: GDAXConfig = {
  logger: logger,
  apiUrl: process.env.GDAX_API_URL || "https://api.gdax.com",
  auth: {
    key: config.GDAX_KEY,
    secret: config.GDAX_SECRET,
    passphrase: config.GDAX_PASSPHRASE,
  },
}
const gdaxAPI = new GDAXExchangeAPI(gdaxConfig)

const [base, quote] = product.split("-")

const getBalances = (profileId: string) =>
  gdaxAPI.loadBalances().then(_ => _[profileId])

async function run(options: GDAXFeedConfig, product: any) {
  const maxDrawDown = Big("0.0001") // 10%
  const triggerMargin = Big("0.01") // 1%

  let highestPrice = Big("0")
  let triggerPrice = Big("0")
  const feed = await GTT.Factories.GDAX.getSubscribedFeeds(options, [product])

  console.log(`base: ${base}`)

  let isLong = (await getBalances(config.userId))[base].available.isZero()
    ? false
    : true
  console.log(`Start position is ${isLong ? "LONG" : "NONE"}.`)

  let activeTrigger: Trigger<TickerMessage>

  const updateTriggerAction = async (ticker: TickerMessage) => {
    console.log("tick")
    if (ticker.price.greaterThan(highestPrice)) {
      // new all time high!
      highestPrice = ticker.price
      triggerPrice = highestPrice.times(Big("1").minus(maxDrawDown))
      console.log("New highestPrice: " + highestPrice)
      console.log("New triggerPrice: " + triggerPrice)

      const balances = await getBalances(config.userId)
      const baseBalance = balances[base].available
      const quoteBalance = balances[quote].available

      if (activeTrigger != null) {
        activeTrigger.cancel()
      }
      if (isLong) {
        // update position of stop loss
        activeTrigger = GTT.Core.createPriceTrigger(
          feed,
          product,
          triggerPrice
        ).setAction(async (event: TickerMessage) => {
          pushMessage(
            "Price Trigger",
            `${base} price has fallen and is now ${
              event.price
            } ${quote} on ${product} on GDAX`
          )
          await submitTrade("sell", baseBalance.toString())
          isLong = false
        })
      } else {
        // buy
        pushMessage(
          "Price Trigger",
          `${base} price has risen and is now ${
            ticker.price
          } ${quote} on ${product} on GDAX`
        )
        await submitTrade("buy", quoteBalance.toString())
        isLong = true
      }
    }
  }
  GTT.Core.createTickerTrigger(feed, product, false).setAction(
    updateTriggerAction
  )
}

function submitTrade(side: string, amount: string) {
  const order: PlaceOrderMessage = {
    type: "placeOrder",
    time: null,
    productId: product,
    orderType: "market",
    side: side,
    size: amount,
  }
  return gdaxAPI.placeOrder(order).then((result: LiveOrder) => {
    pushMessage(
      "Order executed",
      `Order to ${order.side} 0.1 ${base} placed. Result: ${result.status}`
    )
  })
}

function pushMessage(title: string, msg: string): void {
  console.log("TRADE:")
  console.log(title)
  console.log(msg)
}

const options: GDAXFeedConfig = {
  logger: logger,
  auth: { key: null, secret: null, passphrase: null }, // use public feed
  channels: ["ticker"],
  wsUrl: GDAX_WS_FEED,
  apiUrl: GDAX_API_URL,
}

run(options, product)
