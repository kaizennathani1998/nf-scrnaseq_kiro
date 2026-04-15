import React from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Dna, LayoutDashboard, Plus, Activity, FlaskConical } from 'lucide-react'
import clsx from 'clsx'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard'    },
  { to: '/runs/new',  icon: Plus,            label: 'New Run'      },
  { to: '/analyze',   icon: FlaskConical,    label: 'Analyze h5ad' },
]

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-800">
          <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center">
            <Dna size={20} className="text-white" />
          </div>
          <div>
            <p className="font-semibold text-sm text-white leading-tight">scRNASeq</p>
            <p className="text-xs text-gray-500">HealthOmics</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-600/20 text-brand-400'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-800">
          <div className="flex items-center gap-2">
            <Activity size={14} className="text-green-400" />
            <span className="text-xs text-gray-500">AWS HealthOmics</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
