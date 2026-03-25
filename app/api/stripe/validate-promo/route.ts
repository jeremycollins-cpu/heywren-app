import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/server'

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin')
    const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
    if (origin && allowedOrigin && origin !== allowedOrigin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { code } = await request.json()

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ valid: false, error: 'Please enter a promo code' }, { status: 400 })
    }

    // Look up the promotion code in Stripe
    const promoCodes = await stripe.promotionCodes.list({
      code: code.trim().toUpperCase(),
      active: true,
      limit: 1,
    })

    if (promoCodes.data.length === 0) {
      return NextResponse.json({ valid: false, error: 'Invalid or expired promo code' })
    }

    const promoCode = promoCodes.data[0]
    const coupon = promoCode.coupon

    if (!coupon.valid) {
      return NextResponse.json({ valid: false, error: 'This promo code has expired' })
    }

    let message = ''
    if (coupon.percent_off) {
      message = `${coupon.percent_off}% off${coupon.duration === 'repeating' ? ` for ${coupon.duration_in_months} months` : coupon.duration === 'once' ? ' (first payment)' : ' (forever)'}`
    } else if (coupon.amount_off) {
      const amount = (coupon.amount_off / 100).toFixed(2)
      message = `$${amount} off${coupon.duration === 'repeating' ? ` for ${coupon.duration_in_months} months` : coupon.duration === 'once' ? ' (first payment)' : ' (forever)'}`
    }

    return NextResponse.json({
      valid: true,
      message,
      percentOff: coupon.percent_off || undefined,
      amountOff: coupon.amount_off ? coupon.amount_off / 100 : undefined,
      promoCodeId: promoCode.id,
    })
  } catch (error: any) {
    console.error('Validate promo error:', error)
    return NextResponse.json({ valid: false, error: 'Failed to validate code' }, { status: 500 })
  }
}
