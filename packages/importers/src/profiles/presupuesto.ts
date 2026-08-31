import type { WorkbookProfile } from '../workbook';

/**
 * The owner's personal `PresupuestoYYYY.xlsx` tracker.
 *
 * Layout, as read from the real workbook:
 *   - One sheet per month, named in Spanish (`Enero` … `Diciembre`).
 *   - Row 1 is a header: `Conceptos | Ingresos | Total | Conceptos | Gastos | Total | | Resultado`.
 *   - Two blocks side by side from row 2: income in A/B, expenses in D/E.
 *   - `C2`, `F2` and `H2` hold SUM formulas — totals, not movements, and outside
 *     the scanned columns, so they are never imported as transactions.
 *   - Amounts are positive magnitudes in both blocks. A negative value inside the
 *     expense block is a refund and stays a refund once the block's sign is applied.
 *   - `Totales`, `Backend` and `Venta Objetivos` carry summaries and lookup lists.
 *     They are not listed below, so they are ignored.
 *
 * There is no date column: the month comes from the sheet name and the year from
 * the filename. See `dayOfMonth`.
 */
export const PRESUPUESTO_XLSX: WorkbookProfile = {
  id: 'presupuesto-xlsx',
  label: 'Presupuesto (my tracker)',

  monthSheets: {
    Enero: 1,
    Febrero: 2,
    Marzo: 3,
    Abril: 4,
    Mayo: 5,
    Junio: 6,
    Julio: 7,
    Agosto: 8,
    Septiembre: 9,
    Octubre: 10,
    Noviembre: 11,
    Diciembre: 12,
  },

  firstDataRow: 2,
  lastDataRow: 1000,

  blocks: [
    { conceptColumn: 'A', amountColumn: 'B', direction: 'income' },
    { conceptColumn: 'D', amountColumn: 'E', direction: 'expense' },
  ],

  defaultCurrency: 'EUR',

  /**
   * The sheet records the month but never the day, so every movement in a month
   * is booked on the 1st. One fixed day keeps monthly and yearly figures exact
   * — the only granularity this ledger ever had — and makes the missing
   * precision obvious rather than plausible. Spreading rows across invented days
   * would look more precise while being less true.
   */
  dayOfMonth: 1,

  categoryMap: {
    income: {
      nomina: 'income-salary',
      bonusseguro: 'income-salary',
      espp: 'income-investment',
      blockfi: 'income-investment',
      intereses: 'income-investment',
      dividendo: 'income-investment',
      paro: 'income-benefits',
      steuererklarung: 'income-refund',
      seguropayback: 'income-refund',
      kaution: 'income-refund',
      splitwisesk: 'income-refund',
      workphone: 'income-refund',
      kms: 'income-refund',
      dietas: 'income-refund',
      cashback: 'income-refund',
      fotografia: 'income-freelance',
      ventafotos: 'income-freelance',
      ventasfotos: 'income-freelance',
      mixingmastering: 'income-freelance',
      ventas2mano: 'income-other',
      cumpleanos: 'income-other',
      blablacar: 'income-other',
      infcomp: 'income-other',
      puas: 'income-other',
    },

    expense: {
      // Housing
      alquiler: 'housing-rent',
      kaution: 'housing-rent',
      immoscout: 'housing-rent',
      inmoscout: 'housing-rent',
      nebenkosten: 'housing-utilities',
      electricidad: 'housing-utilities',
      internet: 'housing-internet',
      movil: 'housing-internet',
      casa: 'housing-maintenance',
      muebles: 'housing-maintenance',
      ikea: 'housing-maintenance',
      obi: 'housing-maintenance',
      lavadora: 'housing-maintenance',
      bateriaaspiradora: 'housing-maintenance',
      tintoreria: 'housing-maintenance',
      furgomudanza: 'housing-maintenance',
      carromudanza: 'housing-maintenance',

      // Food and drink
      supermercado: 'food-groceries',
      comidafuera: 'food-restaurants',
      bebercio: 'food-restaurants',
      bebeecio: 'food-restaurants',
      cafe: 'food-restaurants',
      helado: 'food-restaurants',

      // Transport
      diesel: 'transport-car',
      gasolina: 'transport-car',
      adblue: 'transport-car',
      segurocoche: 'insurance',
      lavadocoche: 'transport-car',
      lavadodecoche: 'transport-car',
      reparacionescoche: 'transport-car',
      revision: 'transport-car',
      tuv: 'transport-car',
      itvm: 'transport-car',
      ruedas: 'transport-car',
      parking: 'transport-car',
      peaje: 'transport-car',
      vineta: 'transport-car',
      vinetasuiza: 'transport-car',
      multas: 'transport-car',
      alquilercoche: 'transport-car',
      cochedealquiler: 'transport-car',
      transportepublico: 'transport-public',
      movilidad: 'transport-public',
      trenes: 'transport-public',
      tren: 'transport-public',

      // Travel
      vuelos: 'transport-travel',
      hotel: 'transport-travel',
      hoteles: 'transport-travel',
      viajes: 'transport-travel',
      vacaciones: 'transport-travel',
      turismo: 'transport-travel',
      freetour: 'transport-travel',
      souvenirs: 'transport-travel',
      diabarco: 'transport-travel',
      venezia: 'transport-travel',
      chiemsee: 'transport-travel',
      alhambra: 'transport-travel',
      maletas: 'transport-travel',
      sinmaletas: 'transport-travel',
      notflying: 'transport-travel',

      // Health and insurance
      halleschekv: 'insurance',
      halleschepv: 'insurance',
      seguro: 'insurance',
      seguromedico: 'insurance',
      segurodron: 'insurance',
      haftpflichtversicherung: 'insurance',
      medicos: 'health-medical',
      medicinas: 'health-medical',
      farmacia: 'health-medical',
      gafas: 'health-medical',
      masaje: 'health-medical',

      // Subscriptions and software
      spotify: 'subscriptions',
      netflix: 'subscriptions',
      dazn: 'subscriptions',
      amazonprime: 'subscriptions',
      chatgpt: 'subscriptions',
      gemini: 'subscriptions',
      google: 'subscriptions',
      googleone: 'subscriptions',
      abacusai: 'subscriptions',
      distrokid: 'subscriptions',
      photoshop: 'subscriptions',
      lumin: 'subscriptions',
      squarespace: 'subscriptions',
      dominio: 'subscriptions',

      // Sport
      wellpass: 'sport',
      gympass: 'sport',
      gym: 'sport',

      // Education and certification
      per: 'education',
      pmp: 'education',
      pmi: 'education',
      pmpstudyhall: 'education',

      // Leisure, music and photography
      musica: 'leisure',
      fotografia: 'leisure',
      conciertos: 'leisure',
      festival: 'leisure',
      fruhlingsfest: 'leisure',
      kaltenberg: 'leisure',
      wiesn: 'leisure',
      feria: 'leisure',
      fiesta: 'leisure',
      therme: 'leisure',
      entradas: 'leisure',
      loteria: 'leisure',
      guardarropa: 'leisure',
      guitarra: 'leisure',
      fundaguitarra: 'leisure',
      pinturaguitarra: 'leisure',
      promocion: 'leisure',
      promocionfoto: 'leisure',
      saaldigital: 'leisure',
      impresionpedido: 'leisure',
      peliculacamara: 'leisure',

      // Shopping
      amazon: 'shopping',
      aliexpress: 'shopping',
      temu: 'shopping',
      ropa: 'shopping',
      iphone: 'shopping',
      macbookair: 'shopping',
      reparacionmovil: 'shopping',
      zapatero: 'shopping',
      peluqueria: 'shopping',
      chuminas: 'shopping',
      correos: 'shopping',

      // Gifts
      regalos: 'gifts-donations',
      cumpleanos: 'gifts-donations',

      // Taxes and fees
      finanzamt: 'taxes',
      impuestocirculacion: 'taxes',
      impuestotv: 'taxes',
      tvtax: 'taxes',
      wundertax: 'taxes',
      pasaporte: 'taxes',
      intereses: 'fees-interest',
      consorsfinanzwtf: 'fees-interest',

      // Savings, card settlement and shared costs
      inversiones: 'savings',
      tarjetadecredito: 'card-payment',
      tarjetacredito: 'card-payment',
      splitwise: 'shared-costs',

      // A refund written into the expense block: the block's sign makes the
      // negative value positive again, so it reads as money returned.
      devolucion: 'income-refund',
    },
  },
};
