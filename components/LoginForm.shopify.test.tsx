// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LoginForm } from './LoginForm'

vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(() => ({ auth: {} })),
}))

describe('LoginForm Shopify connector isolation', () => {
  it('shows free connector context without pricing or plan onboarding links', () => {
    render(<LoginForm nextPath="/shopify/link" />)

    expect(screen.getByText(/connector has no app charge/i)).toBeTruthy()
    const createLinks = screen.getAllByRole('link', { name: 'Create account' })
    expect(createLinks.length).toBeGreaterThan(0)
    expect(createLinks.every((link) => link.getAttribute('href')?.includes('%2Fshopify%2Flink'))).toBe(true)
    expect(screen.queryByRole('link', { name: 'Pricing' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Start Free' })).toBeNull()
  })
})
